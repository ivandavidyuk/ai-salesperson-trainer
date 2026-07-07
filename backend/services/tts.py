"""TTS — синтез речи через ElevenLabs (REST API).

Принимает текст, синтезирует его голосом из настроек (ELEVENLABS_VOICE_ID),
возвращает аудио в формате MP3 и нарезает его на чанки.

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


async def synthesize(text: str) -> bytes:
    """Синтезирует речь и возвращает аудио целиком (MP3)."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise RuntimeError("Не задан ELEVENLABS_API_KEY для TTS")
    if not settings.elevenlabs_voice_id:
        raise RuntimeError("Не задан ELEVENLABS_VOICE_ID для TTS")

    url = (
        f"{API_BASE}/text-to-speech/{settings.elevenlabs_voice_id}"
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

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        audio = response.content

    logger.info(
        "TTS синтезировал %d байт аудио (модель %s)",
        len(audio),
        settings.elevenlabs_tts_model,
    )
    return audio


def chunk_audio(audio: bytes) -> Iterator[bytes]:
    """Нарезает аудио на чанки фиксированного размера."""
    for offset in range(0, len(audio), CHUNK_SIZE):
        yield audio[offset : offset + CHUNK_SIZE]


async def synthesize_chunks(text: str) -> AsyncIterator[bytes]:
    """Синтезирует речь и отдаёт её чанками (удобно для стриминга клиенту)."""
    audio = await synthesize(text)
    for chunk in chunk_audio(audio):
        yield chunk
