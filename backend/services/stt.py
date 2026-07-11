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

Устойчивость к лимиту сессии ElevenLabs (session_time_limit_exceeded):
- проактивная ротация make-before-break: заранее открываем второе
  соединение и на границе очередного коммита мгновенно переключаемся;
- реактивный реконнект с бэкоффом — страховка от сетевых сбоев;
- скользящий аудиобуфер с последнего коммита: при любом реконнекте
  несданная фраза досылается в новую сессию и не теряется.
"""

import asyncio
import base64
import json
import logging
import math
import time
from array import array
from collections import deque
from typing import Awaitable, Callable, Optional
from urllib.parse import urlencode

import websockets
from websockets.protocol import State

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

# Типы сообщений-ошибок от ElevenLabs (все содержат поле error).
# session_time_limit_exceeded обрабатывается отдельно — это не ошибка,
# а сигнал переподключиться.
_ERROR_TYPES = {
    "error",
    "auth_error",
    "quota_exceeded",
    "commit_throttled",
    "unaccepted_terms",
    "rate_limited",
    "queue_overflow",
    "resource_exhausted",
    "input_error",
    "chunk_size_exceeded",
    "transcriber_error",
}

# Проактивная ротация: возраст соединения, после которого на ближайшей
# границе коммита переключаемся на заранее открытую сессию. Подобрать по
# фактическому лимиту тарифа из логов (см. лог возраста при обрыве).
_ROTATE_AFTER_SECS = 8 * 60

# Скользящий буфер несданной фразы: PCM16 16 кГц ≈ 32 КБ/с, 30 с ≈ 1 МБ
_REPLAY_BUFFER_MAX_BYTES = 30 * SAMPLE_RATE * 2

# Паузы между попытками реактивного реконнекта
_RECONNECT_BACKOFF_SECS = (0.5, 1.0, 2.0)


async def _close_quietly(ws: websockets.ClientConnection) -> None:
    """Закрывает соединение, игнорируя ошибки (оно могло уже умереть)."""
    try:
        await ws.close()
    except Exception:  # noqa: BLE001
        pass

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
        on_fatal: Optional[OnVoiceEvent] = None,
    ) -> None:
        self._api_key = api_key
        self._on_final = on_final
        # Голос появился после коммита (для отмены пайплайна со склейкой)
        self._on_voice_resumed = on_voice_resumed
        # Устойчивый громкий голос в скользящем окне (для barge-in по RMS)
        self._on_sustained_voice = on_sustained_voice
        # Partial-транскрипт (для barge-in по распознанным словам)
        self._on_partial = on_partial
        # Распознавание умерло и не восстановилось (все попытки исчерпаны)
        self._on_fatal = on_fatal
        self._ws: Optional[websockets.ClientConnection] = None
        self._task: Optional[asyncio.Task] = None
        self._closed = False

        # Сериализует отправку аудио и атомарное переключение соединений:
        # пока идёт swap/реплей, push_audio ждёт и шлёт уже в новую сессию
        self._send_lock = asyncio.Lock()
        self._connected_at = 0.0  # monotonic-время открытия активной сессии

        # Скользящий буфер аудио с последнего коммита: при реконнекте
        # несданная фраза досылается в новую сессию целиком
        self._replay_buffer: deque[bytes] = deque()
        self._replay_bytes = 0

        # Make-before-break: заранее открытое соединение для ротации
        self._next_ws: Optional[websockets.ClientConnection] = None
        self._preopen_task: Optional[asyncio.Task] = None

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

        self._ws = await self._open_ws()
        self._connected_at = time.monotonic()

        # Пока голоса не было, тишину не отсчитываем от «начала эпохи»
        self._last_voice_ts = time.monotonic()

        self._task = asyncio.create_task(self._run())
        logger.info("STT: WebSocket-стрим ElevenLabs запущен")

    async def _open_ws(self) -> websockets.ClientConnection:
        """Открывает новое соединение с ElevenLabs Realtime STT."""
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
            return await websockets.connect(url, additional_headers=headers)
        except TypeError:
            return await websockets.connect(url, extra_headers=headers)

    async def _run(self) -> None:
        """Цикл жизни распознавания: чтение + переподключение при обрывах.

        _consume возвращает True после ротации (читать уже новую сессию)
        и False при обрыве соединения — тогда реактивный реконнект.
        """
        while not self._closed:
            rotated = False
            try:
                rotated = await self._consume()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.error("Ошибка STT-стрима: %s", exc)
            if self._closed:
                return
            if rotated:
                continue
            if not await self._reconnect():
                logger.error(
                    "STT: реконнект не удался, распознавание остановлено"
                )
                if self._on_fatal is not None:
                    await self._on_fatal()
                return

    async def _consume(self) -> bool:
        """Читает ответы распознавания и вызывает колбэк на финальных фразах.

        Возвращает True, если чтение прервано ротацией на новую сессию
        (нужно продолжить чтение из неё), и False при обрыве соединения.
        """
        ws = self._ws
        assert ws is not None
        try:
            async for raw in ws:
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
                    # Фраза сдана — буфер реплея больше не нужен
                    self._clear_replay_buffer()
                    text = (msg.get("text") or "").strip()
                    if text and not had_voice:
                        # С прошлого коммита во входящем аудио не было голоса —
                        # это пере-декодированный остаток буфера, не речь
                        logger.info(
                            "STT: отброшен фантомный коммит (пик RMS %.0f): %s",
                            peak_rms,
                            text,
                        )
                    elif text:
                        # Пиковый RMS в логе позволяет по проду отличить
                        # реальную речь от эха ответа ИИ через AEC
                        logger.info(
                            "STT финальный результат (пик RMS %.0f): %s",
                            peak_rms,
                            text,
                        )
                        await self._on_final(text)
                    # Граница коммита — безопасная точка для ротации:
                    # запоздавшие фантомы старой сессии умирают вместе с ней
                    if self._rotation_due() and await self._swap_connection():
                        return True
                elif msg_type == "session_time_limit_exceeded":
                    # Штатный лимит сессии тарифа — не ошибка, переподключаемся
                    logger.warning(
                        "STT: достигнут лимит сессии (возраст %.0f с) — "
                        "переподключение",
                        time.monotonic() - self._connected_at,
                    )
                    return False
                elif msg_type in _ERROR_TYPES:
                    logger.error(
                        "STT ошибка (%s): %s", msg_type, msg.get("error")
                    )
        except websockets.ConnectionClosed:
            if not self._closed:
                logger.warning(
                    "STT: соединение закрыто сервером (возраст %.0f с)",
                    time.monotonic() - self._connected_at,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Ошибка STT-стрима: %s", exc)
            raise
        return False

    # ------------------------------------------------------------------
    # Устойчивость соединения: буфер реплея, ротация, реконнект
    # ------------------------------------------------------------------

    def _buffer_chunk(self, data: bytes) -> None:
        """Копит аудио с последнего коммита для реплея при реконнекте."""
        self._replay_buffer.append(data)
        self._replay_bytes += len(data)
        while self._replay_bytes > _REPLAY_BUFFER_MAX_BYTES and self._replay_buffer:
            dropped = self._replay_buffer.popleft()
            self._replay_bytes -= len(dropped)

    def _clear_replay_buffer(self) -> None:
        self._replay_buffer.clear()
        self._replay_bytes = 0

    async def _replay_to(self, ws: websockets.ClientConnection) -> None:
        """Досылает несданную фразу в новую сессию (быстрее реального времени)."""
        if not self._replay_buffer:
            return
        for chunk in list(self._replay_buffer):
            await ws.send(
                json.dumps(
                    {
                        "message_type": "input_audio_chunk",
                        "audio_base_64": base64.b64encode(chunk).decode("ascii"),
                        "commit": False,
                        "sample_rate": SAMPLE_RATE,
                    }
                )
            )
        # Уже в новой сессии — не дублируем при следующем реконнекте
        self._clear_replay_buffer()

    def _rotation_due(self) -> bool:
        return time.monotonic() - self._connected_at >= _ROTATE_AFTER_SECS

    def _maybe_preopen(self) -> None:
        """Заранее открывает соединение для ротации (make-before-break)."""
        if self._closed or not self._rotation_due():
            return
        if self._next_ws is not None:
            return
        if self._preopen_task is not None and not self._preopen_task.done():
            return
        self._preopen_task = asyncio.create_task(self._preopen_next())

    async def _preopen_next(self) -> None:
        try:
            ws = await self._open_ws()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "STT: не удалось заранее открыть соединение для ротации: %s",
                exc,
            )
            return
        if self._closed:
            await _close_quietly(ws)
            return
        self._next_ws = ws
        logger.info("STT: соединение для ротации готово")

    async def _swap_connection(self) -> bool:
        """Мгновенно переключается на заранее открытую сессию.

        Вызывается на границе коммита. Возвращает False, если запасное
        соединение ещё не готово или умерло — тогда работаем на старом
        до следующего коммита (реактивный реконнект остаётся страховкой).
        """
        next_ws = self._next_ws
        if next_ws is None:
            return False
        self._next_ws = None
        if next_ws.state is not State.OPEN:
            await _close_quietly(next_ws)
            return False

        old_ws = self._ws
        # Лок гарантирует: ни один чанк не уйдёт в старую сессию после
        # реплея — push_audio ждёт и продолжает уже в новую
        async with self._send_lock:
            try:
                # Чанки, успевшие прийти после коммита (начало новой фразы)
                await self._replay_to(next_ws)
            except websockets.ConnectionClosed:
                await _close_quietly(next_ws)
                return False
            self._ws = next_ws
            self._connected_at = time.monotonic()
            # Состояние детектора конца фразы — под новую сессию
            self._partial_text = ""
            self._commit_sent = False
        if old_ws is not None:
            asyncio.create_task(_close_quietly(old_ws))
        logger.info("STT: ротация сессии выполнена (make-before-break)")
        return True

    async def _reconnect(self) -> bool:
        """Реактивный реконнект после обрыва: бэкофф + реплей буфера.

        _voice_since_commit не сбрасываем: обрыв мог случиться посреди
        фразы, и голос в ней уже был — иначе её коммит после реплея
        отбросился бы как фантомный.
        """
        for delay in _RECONNECT_BACKOFF_SECS:
            if self._closed:
                return False
            # Если ротация уже подготовила соединение — используем его
            ws = self._next_ws
            self._next_ws = None
            if ws is not None and ws.state is not State.OPEN:
                await _close_quietly(ws)
                ws = None
            if ws is None:
                try:
                    ws = await self._open_ws()
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "STT: попытка реконнекта не удалась (%s), пауза %.1f с",
                        exc,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue
            async with self._send_lock:
                try:
                    replayed_bytes = self._replay_bytes
                    await self._replay_to(ws)
                except websockets.ConnectionClosed:
                    await asyncio.sleep(delay)
                    continue
                self._ws = ws
                self._connected_at = time.monotonic()
                self._partial_text = ""
                self._commit_sent = False
            logger.info(
                "STT: реконнект успешен, дослано %d байт несданной фразы",
                replayed_bytes,
            )
            return True
        return False

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
            async with self._send_lock:
                await self._ws.send(json.dumps(message))
            logger.info(
                "STT: семантический коммит (тишина %.2f с): %s",
                silence,
                self._partial_text,
            )
        except websockets.ConnectionClosed:
            # Соединение умерло — фразу зафиксирует новая сессия после
            # реплея буфера (реактивный реконнект в _run)
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

        # Буфер реплея: при обрыве соединения фраза досылается заново
        self._buffer_chunk(data)
        # Пора ли заранее открыть соединение для ротации
        self._maybe_preopen()

        message = {
            "message_type": "input_audio_chunk",
            "audio_base_64": base64.b64encode(data).decode("ascii"),
            "commit": False,  # фиксацию выполняет VAD или семантический коммит
            "sample_rate": SAMPLE_RATE,
        }
        try:
            # Лок сериализует отправку с ротацией/реконнектом: после swap
            # чанк уйдёт уже в новую сессию
            async with self._send_lock:
                await self._ws.send(json.dumps(message))
        except websockets.ConnectionClosed:
            # Чанк остался в буфере реплея — реконнект в _run дошлёт его
            return

        # Тишина «созревает» между partial'ами — проверяем и на каждом чанке
        await self._maybe_semantic_commit()

    async def stop(self) -> None:
        """Завершает поток распознавания и закрывает соединение."""
        if self._closed:
            return
        self._closed = True

        if self._preopen_task is not None and not self._preopen_task.done():
            self._preopen_task.cancel()

        for ws in (self._ws, self._next_ws):
            if ws is None:
                continue
            try:
                await ws.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("STT: ошибка при закрытии WebSocket: %s", exc)
        self._next_ws = None

        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            except Exception as exc:  # noqa: BLE001
                logger.warning("STT: ошибка при завершении: %s", exc)

        logger.info("STT: остановлен")
