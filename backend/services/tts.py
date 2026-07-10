"""TTS — синтез речи через ElevenLabs.

Основной путь — TtsWsStream: постоянное multi-context WebSocket-соединение
на всю сессию. Каждое предложение синтезируется в отдельном контексте,
чанки MP3 отдаются по мере генерации. Соединение устанавливается один раз
на старте сессии, поэтому на каждой реплике экономится TCP/TLS-рукопожатие
(~100-300 мс до первого звука по замерам на проде).

Фолбэк — synthesize_stream (HTTP /stream), если WebSocket недоступен.

Модель задаётся через ELEVENLABS_TTS_MODEL:
  eleven_flash_v2_5 — минимальная задержка (по умолчанию);
  eleven_v3         — эмоции и audio-теги ([sighs], [hesitant]), но медленнее.
"""

import asyncio
import base64
import itertools
import json
import logging
from typing import AsyncIterator, Iterator, Optional
from urllib.parse import urlencode

import httpx
import websockets
from websockets.protocol import State

from core.config import get_settings

logger = logging.getLogger(__name__)

# Базовый URL ElevenLabs API
API_BASE = "https://api.elevenlabs.io/v1"

# WebSocket-эндпоинт multi-context TTS
WS_BASE = "wss://api.elevenlabs.io/v1"

# Формат вывода: MP3 44.1 кГц 64 кбит/с — компромисс качество/размер для речи
OUTPUT_FORMAT = "mp3_44100_64"

# Размер аудио-чанка для отправки клиенту (в байтах)
CHUNK_SIZE = 16 * 1024

# Максимальный таймаут неактивности соединения, допускаемый ElevenLabs (сек).
# Если менеджер говорит/молчит дольше — соединение закроется, и мы
# переподключимся при следующем предложении.
WS_INACTIVITY_TIMEOUT = 180

# Таймаут ожидания очередного сообщения при синтезе одного предложения (сек)
WS_RECV_TIMEOUT = 15

VOICE_SETTINGS = {"stability": 0.5, "similarity_boost": 0.75}

# Общий HTTP-клиент на модуль: переиспользует TCP/TLS-соединения
_client = httpx.AsyncClient(timeout=60)


class TtsWsStream:
    """Постоянный multi-context WebSocket TTS на одну голосовую сессию.

    Использование:
        stream = TtsWsStream()
        await stream.start()                 # на старте сессии
        async for chunk in stream.stream_sentence("Привет."): ...
        await stream.stop()                  # при закрытии сессии
    """

    def __init__(self) -> None:
        self._ws: Optional[websockets.ClientConnection] = None
        self._ctx_counter = itertools.count(1)
        self._closed = False

    async def start(self) -> None:
        """Устанавливает WebSocket-соединение заранее (на старте сессии)."""
        await self._connect()

    async def _connect(self) -> None:
        settings = get_settings()
        if not settings.elevenlabs_api_key:
            raise RuntimeError("Не задан ELEVENLABS_API_KEY для TTS")
        if not settings.elevenlabs_voice_id:
            raise RuntimeError("Не задан ELEVENLABS_VOICE_ID для TTS")

        query = urlencode(
            {
                "model_id": settings.elevenlabs_tts_model,
                "output_format": OUTPUT_FORMAT,
                "inactivity_timeout": WS_INACTIVITY_TIMEOUT,
            }
        )
        url = (
            f"{WS_BASE}/text-to-speech/{settings.elevenlabs_voice_id}"
            f"/multi-stream-input?{query}"
        )
        headers = {"xi-api-key": settings.elevenlabs_api_key}
        try:
            self._ws = await websockets.connect(url, additional_headers=headers)
        except TypeError:
            # Старые версии websockets используют другое имя параметра
            self._ws = await websockets.connect(url, extra_headers=headers)
        logger.info("TTS: WebSocket-стрим ElevenLabs установлен")

    async def _ensure_connected(self) -> websockets.ClientConnection:
        """Возвращает живое соединение, переподключаясь при необходимости."""
        if self._ws is None or self._ws.state is not State.OPEN:
            await self._connect()
        assert self._ws is not None
        return self._ws

    async def stream_sentence(self, text: str) -> AsyncIterator[bytes]:
        """Синтезирует одно предложение, отдаёт MP3-чанки по мере генерации.

        Каждое предложение — отдельный контекст: сервер присылает isFinal,
        по которому мы понимаем, что синтез предложения завершён.
        """
        ws = await self._ensure_connected()
        ctx = f"s{next(self._ctx_counter)}"

        # Инициализация контекста, текст с flush (генерация без ожидания
        # буфера) и закрытие контекста — одним махом. close_context уходит
        # сразу: сервер сам завершит контекст после генерации (isFinal),
        # отдельного закрытия при отмене не требуется.
        await ws.send(json.dumps({
            "text": " ",
            "context_id": ctx,
            "voice_settings": VOICE_SETTINGS,
        }))
        await ws.send(json.dumps({"text": text + " ", "context_id": ctx, "flush": True}))
        await ws.send(json.dumps({"context_id": ctx, "close_context": True}))

        total = 0
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=WS_RECV_TIMEOUT)
                msg = json.loads(raw)
                # Сообщения других контекстов (в т.ч. запоздавшие чанки
                # брошенного при отмене контекста) пропускаем
                if msg.get("contextId") not in (ctx, None):
                    continue
                audio_b64 = msg.get("audio")
                if audio_b64:
                    chunk = base64.b64decode(audio_b64)
                    total += len(chunk)
                    yield chunk
                if msg.get("isFinal"):
                    break
        except (asyncio.CancelledError, GeneratorExit):
            # Пайплайн отменён (склейка фразы или barge-in): бросаем чтение,
            # соединение остаётся живым для следующих предложений. Квота на
            # уже отправленный текст сгорает (у ElevenLabs нет abort), но
            # неотправленные предложения ходa синтезироваться не будут.
            logger.info(
                "TTS: синтез контекста %s брошен (отмена, получено %d байт)",
                ctx,
                total,
            )
            raise

        logger.info("TTS отстримил %d байт аудио (WS)", total)

    async def stop(self) -> None:
        """Закрывает соединение при завершении сессии."""
        if self._closed:
            return
        self._closed = True
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps({"close_socket": True}))
                await self._ws.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("TTS: ошибка при закрытии WebSocket: %s", exc)
        logger.info("TTS: WebSocket-стрим остановлен")


def _request_parts(text: str, stream: bool) -> tuple[str, dict, dict]:
    """Собирает URL, payload и заголовки запроса синтеза."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise RuntimeError("Не задан ELEVENLABS_API_KEY для TTS")
    if not settings.elevenlabs_voice_id:
        raise RuntimeError("Не задан ELEVENLABS_VOICE_ID для TTS")

    suffix = "/stream" if stream else ""
    url = (
        f"{API_BASE}/text-to-speech/{settings.elevenlabs_voice_id}{suffix}"
        f"?output_format={OUTPUT_FORMAT}"
    )
    payload = {
        "text": text,
        "model_id": settings.elevenlabs_tts_model,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    return url, payload, headers


async def synthesize_stream(text: str) -> AsyncIterator[bytes]:
    """Синтезирует речь и отдаёт MP3-чанки по мере генерации.

    Использует эндпоинт /stream: первый чанк приходит до завершения
    синтеза всей фразы, что заметно снижает задержку до первого звука.
    """
    url, payload, headers = _request_parts(text, stream=True)

    total = 0
    async with _client.stream("POST", url, json=payload, headers=headers) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            if chunk:
                total += len(chunk)
                yield chunk

    logger.info("TTS отстримил %d байт аудио", total)


async def synthesize(text: str) -> bytes:
    """Синтезирует речь и возвращает аудио целиком (MP3)."""
    url, payload, headers = _request_parts(text, stream=False)

    response = await _client.post(url, json=payload, headers=headers)
    response.raise_for_status()
    audio = response.content

    logger.info("TTS синтезировал %d байт аудио", len(audio))
    return audio


def chunk_audio(audio: bytes) -> Iterator[bytes]:
    """Нарезает аудио на чанки фиксированного размера."""
    for offset in range(0, len(audio), CHUNK_SIZE):
        yield audio[offset : offset + CHUNK_SIZE]
