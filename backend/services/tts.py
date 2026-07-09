"""TTS — синтез речи через ElevenLabs (REST API).

Принимает текст, синтезирует его голосом из настроек (ELEVENLABS_VOICE_ID).
Основной путь — synthesize_stream: чанки MP3 отдаются по мере генерации
(эндпоинт /stream), клиент начинает получать аудио до конца синтеза.

Модель задаётся через ELEVENLABS_TTS_MODEL:
  eleven_flash_v2_5 — минимальная задержка (по умолчанию);
  eleven_v3         — эмоции и audio-теги ([sighs], [hesitant]), но медленнее.
"""

import logging
from typing import AsyncIterator, Iterator

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# Базовый URL ElevenLabs API
API_BASE = "https://api.elevenlabs.io/v1"

# Формат вывода: MP3 44.1 кГц 64 кбит/с — компромисс качество/размер для речи
OUTPUT_FORMAT = "mp3_44100_64"

# Размер аудио-чанка для отправки клиенту (в байтах)
CHUNK_SIZE = 16 * 1024

# Общий HTTP-клиент на модуль: переиспользует TCP/TLS-соединения
_client = httpx.AsyncClient(timeout=60)


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
