"""STT — потоковое распознавание речи через ElevenLabs Realtime (WebSocket).

Принимает аудио-чанки (PCM 16kHz mono), стримит их в ElevenLabs
Speech-to-Text Realtime и при получении зафиксированного результата
(committed_transcript) вызывает переданный колбэк on_final(text).

Конец фразы определяется двумя механизмами:
1. Семантический коммит (быстрый путь): если partial-транскрипт
   заканчивается завершающей пунктуацией и во входящем аудио наступила
   короткая тишина — отправляем принудительный commit, не дожидаясь VAD.
   Для вопросов порог тишины меньше: «...верно?» — явный конец реплики.
2. VAD на стороне ElevenLabs (фолбэк): после паузы EOU_SILENCE_SECS
   сервис сам фиксирует транскрипт (когда пунктуации нет или тихо).

Важно: коммитить только по пунктуации нельзя — partial «что вас
беспокоит?» может прийти, пока менеджер договаривает «...со зрением?»
(проверено на записи). Поэтому семантический коммит требует и тишины,
которую детектируем по RMS-энергии входящих чанков.
"""

import asyncio
import base64
import json
import logging
import math
import time
from array import array
from typing import Awaitable, Callable, Optional
from urllib.parse import urlencode

import websockets

from core.config import get_settings

logger = logging.getLogger(__name__)

# WebSocket-эндпоинт ElevenLabs Realtime STT
STT_ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"

# Частота дискретизации входного аудио (совпадает с записью в браузере)
SAMPLE_RATE = 16000

# Пауза (сек), после которой VAD считает фразу законченной (фолбэк).
# Меньше значение — быстрее ответ, но выше риск обрезать речь на паузах.
EOU_SILENCE_SECS = 0.65

# Семантический коммит: сколько тишины нужно после завершающей пунктуации.
# Вопрос/восклицание — почти наверняка конец реплики, ждём меньше
SEMANTIC_SILENCE_QUESTION_SECS = 0.25
# Точка — менеджер мог просто сделать паузу между предложениями
SEMANTIC_SILENCE_STATEMENT_SECS = 0.40

# Пунктуация, после которой реплика считается семантически завершённой
_QUESTION_ENDINGS = ("?", "!")
_STATEMENT_ENDINGS = (".", "…")

# Детекция тишины по энергии: чанк с RMS ниже порога считается тихим.
# Фиксированный порог: браузер записывает с AGC, речь даёт RMS 1000-5000,
# фоновый шум — до пары сотен. Если фон громче порога (шумный офис),
# семантический коммит просто не сработает и фразу зафиксирует VAD-фолбэк.
_MIN_VOICE_RMS = 500.0

# Серверный запасной детектор: основной быстрый триггер работает в браузере,
# а этот путь подхватывает речь, если клиентский сигнал не сработал.
_BARGE_IN_RMS = 600.0

# Barge-in: скользящее окно детекции. Живая речь неравномерна (паузы между
# словами дают тихие чанки), поэтому требуем не непрерывности, а нескольких
# громких чанков внутри окна: 3 чанка по ~200 мс за 1.2 с ≈ 0.6 с речи.
_BARGE_IN_WINDOW_SECS = 1.2
_BARGE_IN_MIN_LOUD_CHUNKS = 3


def _chunk_rms(data: bytes) -> float:
    """RMS-энергия чанка PCM16 (моно)."""
    samples = array("h")
    samples.frombytes(data[: len(data) // 2 * 2])
    if not samples:
        return 0.0
    acc = 0
    for s in samples:
        acc += s * s
    return math.sqrt(acc / len(samples))

# Типы сообщений-ошибок от ElevenLabs (все содержат поле error)
_ERROR_TYPES = {
    "error",
    "auth_error",
    "quota_exceeded",
    "commit_throttled",
    "unaccepted_terms",
    "rate_limited",
    "queue_overflow",
    "resource_exhausted",
    "session_time_limit_exceeded",
    "input_error",
    "chunk_size_exceeded",
    "transcriber_error",
}

# Тип колбэка: получает финальный распознанный текст
OnFinal = Callable[[str], Awaitable[None]]

# Тип колбэка-уведомления о голосовой активности (без аргументов)
OnVoiceEvent = Callable[[], Awaitable[None]]

# Тип колбэка partial-транскрипта (текст по мере распознавания)
OnPartial = Callable[[str], Awaitable[None]]


class ElevenLabsSTT:
    """Управляет одной потоковой сессией распознавания речи."""

    def __init__(
        self,
        api_key: str,
        on_final: OnFinal,
        on_voice_resumed: Optional[OnVoiceEvent] = None,
        on_sustained_voice: Optional[OnVoiceEvent] = None,
        on_partial: Optional[OnPartial] = None,
    ) -> None:
        self._api_key = api_key
        self._on_final = on_final
        # Голос появился после коммита (для отмены пайплайна со склейкой)
        self._on_voice_resumed = on_voice_resumed
        # Устойчивый громкий голос в скользящем окне (для barge-in по RMS)
        self._on_sustained_voice = on_sustained_voice
        # Partial-транскрипт (для barge-in по распознанным словам)
        self._on_partial = on_partial
        self._ws: Optional[websockets.ClientConnection] = None
        self._task: Optional[asyncio.Task] = None
        self._closed = False

        # Состояние семантического коммита (сбрасывается на каждом committed)
        self._partial_text = ""
        self._last_voice_ts = 0.0     # когда в аудио последний раз был голос
        self._commit_sent = False     # принудительный commit уже отправлен

        # Гейт по голосу: был ли голос во входящем аудио с прошлого коммита.
        # Коммит без голоса — фантом (пере-декодирование остатка буфера
        # ElevenLabs у границы предыдущего коммита), его отбрасываем.
        self._voice_since_commit = False
        self._peak_rms = 0.0          # пиковый RMS с прошлого коммита (в логи)

        # Детектор устойчивого громкого голоса для barge-in:
        # времена громких чанков в скользящем окне
        self._loud_times: list[float] = []
        self._sustained_fired = False

    async def start(self) -> None:
        """Открывает WebSocket-соединение и запускает чтение результатов."""
        if not self._api_key:
            raise RuntimeError("Не задан ELEVENLABS_API_KEY для STT")

        settings = get_settings()
        query = urlencode(
            {
                "model_id": settings.elevenlabs_stt_model,
                "audio_format": f"pcm_{SAMPLE_RATE}",
                "language_code": "ru",
                "commit_strategy": "vad",
                "vad_silence_threshold_secs": EOU_SILENCE_SECS,
            }
        )
        url = f"{STT_ENDPOINT}?{query}"
        headers = {"xi-api-key": self._api_key}

        # Имя параметра заголовков зависит от версии websockets
        try:
            self._ws = await websockets.connect(url, additional_headers=headers)
        except TypeError:
            self._ws = await websockets.connect(url, extra_headers=headers)

        # Пока голоса не было, тишину не отсчитываем от «начала эпохи»
        self._last_voice_ts = time.monotonic()

        self._task = asyncio.create_task(self._consume())
        logger.info("STT: WebSocket-стрим ElevenLabs запущен")

    async def _consume(self) -> None:
        """Читает ответы распознавания и вызывает колбэк на финальных фразах."""
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except (TypeError, ValueError):
                    continue

                msg_type = msg.get("message_type")

                if msg_type == "partial_transcript":
                    # Запоминаем прогресс распознавания для семантического
                    # коммита; текст мог «дозреть» позже начала тишины,
                    # поэтому проверяем условие и здесь
                    self._partial_text = (msg.get("text") or "").strip()
                    if self._on_partial is not None and self._partial_text:
                        await self._on_partial(self._partial_text)
                    await self._maybe_semantic_commit()
                elif msg_type == "committed_transcript":
                    self._partial_text = ""
                    self._commit_sent = False
                    had_voice = self._voice_since_commit
                    peak_rms = self._peak_rms
                    self._voice_since_commit = False
                    self._peak_rms = 0.0
                    # Новый диалоговый ход должен заново вооружить barge-in.
                    # Иначе громкие чанки исходной реплики остаются в окне,
                    # а _sustained_fired блокирует быстрое перебивание ответа.
                    self._loud_times.clear()
                    self._sustained_fired = False
                    text = (msg.get("text") or "").strip()
                    if not text:
                        continue
                    if not had_voice:
                        # С прошлого коммита во входящем аудио не было голоса —
                        # это пере-декодированный остаток буфера, не речь
                        logger.info(
                            "STT: отброшен фантомный коммит (пик RMS %.0f): %s",
                            peak_rms,
                            text,
                        )
                        continue
                    # Пиковый RMS в логе позволяет по проду отличить реальную
                    # речь от эха ответа ИИ, просочившегося через AEC
                    logger.info(
                        "STT финальный результат (пик RMS %.0f): %s",
                        peak_rms,
                        text,
                    )
                    await self._on_final(text)
                elif msg_type in _ERROR_TYPES:
                    logger.error(
                        "STT ошибка (%s): %s", msg_type, msg.get("error")
                    )
        except websockets.ConnectionClosed:
            if not self._closed:
                logger.warning("STT: соединение закрыто сервером")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Ошибка STT-стрима: %s", exc)
            raise

    async def _maybe_semantic_commit(self) -> None:
        """Форсирует commit, если фраза семантически завершена и тихо.

        Оба условия обязательны: пунктуация без тишины — менеджер может
        договаривать фразу; тишина без пунктуации — обычная пауза,
        её обрабатывает VAD-фолбэк.
        """
        if self._commit_sent or self._ws is None or not self._partial_text:
            return
        if self._partial_text.endswith(_QUESTION_ENDINGS):
            need_silence = SEMANTIC_SILENCE_QUESTION_SECS
        elif self._partial_text.endswith(_STATEMENT_ENDINGS):
            need_silence = SEMANTIC_SILENCE_STATEMENT_SECS
        else:
            return
        silence = time.monotonic() - self._last_voice_ts
        if silence < need_silence:
            return

        self._commit_sent = True
        message = {
            "message_type": "input_audio_chunk",
            "audio_base_64": "",
            "commit": True,
            "sample_rate": SAMPLE_RATE,
        }
        try:
            await self._ws.send(json.dumps(message))
            logger.info(
                "STT: семантический коммит (тишина %.2f с): %s",
                silence,
                self._partial_text,
            )
        except websockets.ConnectionClosed:
            pass

    @property
    def seconds_since_voice(self) -> float:
        """Сколько секунд назад во входящем аудио последний раз был голос."""
        return time.monotonic() - self._last_voice_ts

    async def push_audio(self, data: bytes) -> None:
        """Передаёт очередной аудио-чанк в распознавание."""
        if self._closed or self._ws is None:
            return

        # Локальный детектор голоса/тишины для семантического коммита
        rms = _chunk_rms(data)
        now = time.monotonic()
        if rms > self._peak_rms:
            self._peak_rms = rms
        if rms > _MIN_VOICE_RMS:
            self._last_voice_ts = now
            if not self._voice_since_commit:
                self._voice_since_commit = True
                # Голос после тишины: даём main.py шанс отменить пайплайн,
                # если менеджер продолжил разрезанную коммитом фразу
                if self._on_voice_resumed is not None:
                    await self._on_voice_resumed()

        # Устойчивый громкий голос — сигнал barge-in (перебивание ИИ).
        # Скользящее окно: одиночные тихие чанки (паузы между словами)
        # не сбрасывают отсчёт, короткий стук/кашель не триггерит.
        if rms > _BARGE_IN_RMS:
            self._loud_times.append(now)
        self._loud_times = [
            t for t in self._loud_times if now - t <= _BARGE_IN_WINDOW_SECS
        ]
        if not self._loud_times:
            self._sustained_fired = False
        elif (
            not self._sustained_fired
            and len(self._loud_times) >= _BARGE_IN_MIN_LOUD_CHUNKS
        ):
            self._sustained_fired = True
            if self._on_sustained_voice is not None:
                await self._on_sustained_voice()

        message = {
            "message_type": "input_audio_chunk",
            "audio_base_64": base64.b64encode(data).decode("ascii"),
            "commit": False,  # фиксацию выполняет VAD или семантический коммит
            "sample_rate": SAMPLE_RATE,
        }
        try:
            await self._ws.send(json.dumps(message))
        except websockets.ConnectionClosed:
            if not self._closed:
                logger.warning("STT: не удалось отправить аудио — стрим закрыт")
            return

        # Тишина «созревает» между partial'ами — проверяем и на каждом чанке
        await self._maybe_semantic_commit()

    async def stop(self) -> None:
        """Завершает поток распознавания и закрывает соединение."""
        if self._closed:
            return
        self._closed = True

        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("STT: ошибка при закрытии WebSocket: %s", exc)

        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            except Exception as exc:  # noqa: BLE001
                logger.warning("STT: ошибка при завершении: %s", exc)

        logger.info("STT: остановлен")
