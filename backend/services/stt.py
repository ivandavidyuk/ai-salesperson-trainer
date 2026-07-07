"""STT — потоковое распознавание речи через ElevenLabs Realtime (WebSocket).

Принимает аудио-чанки (PCM 16kHz mono), стримит их в ElevenLabs
Speech-to-Text Realtime и при получении зафиксированного результата
(committed_transcript) вызывает переданный колбэк on_final(text).

Конец фразы определяет VAD на стороне ElevenLabs (commit_strategy=vad):
после паузы EOU_SILENCE_SECS сервис сам фиксирует транскрипт.
"""

import asyncio
import base64
import json
import logging
from typing import Awaitable, Callable, Optional
from urllib.parse import urlencode

import websockets

from core.config import get_settings

logger = logging.getLogger(__name__)

# WebSocket-эндпоинт ElevenLabs Realtime STT
STT_ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"

# Частота дискретизации входного аудио (совпадает с записью в браузере)
SAMPLE_RATE = 16000

# Пауза (сек), после которой VAD считает фразу законченной.
# Меньше значение — быстрее ответ, но выше риск обрезать речь на паузах.
EOU_SILENCE_SECS = 1.0

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


class ElevenLabsSTT:
    """Управляет одной потоковой сессией распознавания речи."""

    def __init__(self, api_key: str, on_final: OnFinal) -> None:
        self._api_key = api_key
        self._on_final = on_final
        self._ws: Optional[websockets.ClientConnection] = None
        self._task: Optional[asyncio.Task] = None
        self._closed = False

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

                # Обрабатываем только зафиксированный транскрипт;
                # partial_transcript игнорируем, иначе реплика уйдёт
                # в LLM/TTS несколько раз.
                if msg_type == "committed_transcript":
                    text = (msg.get("text") or "").strip()
                    if text:
                        logger.info("STT финальный результат: %s", text)
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

    async def push_audio(self, data: bytes) -> None:
        """Передаёт очередной аудио-чанк в распознавание."""
        if self._closed or self._ws is None:
            return
        message = {
            "message_type": "input_audio_chunk",
            "audio_base_64": base64.b64encode(data).decode("ascii"),
            "commit": False,  # фиксацию выполняет VAD по паузе
            "sample_rate": SAMPLE_RATE,
        }
        try:
            await self._ws.send(json.dumps(message))
        except websockets.ConnectionClosed:
            if not self._closed:
                logger.warning("STT: не удалось отправить аудио — стрим закрыт")

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
