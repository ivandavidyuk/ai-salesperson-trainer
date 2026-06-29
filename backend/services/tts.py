"""TTS — синтез речи через Yandex SpeechKit (REST API).

Принимает текст, синтезирует его голосом alena (нейтральная эмоция),
возвращает аудио в формате OGG (opus) и нарезает его на чанки.
"""

import logging
from typing import AsyncIterator, Iterator

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# REST-эндпоинт синтеза речи
TTS_URL = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize"

# Размер аудио-чанка для отправки клиенту (в байтах)
CHUNK_SIZE = 16 * 1024


async def synthesize(text: str) -> bytes:
    """Синтезирует речь и возвращает аудио целиком (OGG/opus)."""
    settings = get_settings()
    if not settings.yandex_api_key:
        raise RuntimeError("Не задан YANDEX_API_KEY для TTS")

    data = {
        "text": text,
        "voice": "alena",
        "emotion": "neutral",
        "speed": "1.0",
        "format": "oggopus",
        "lang": "ru-RU",
        "folderId": settings.yandex_folder_id,
    }
    headers = {"Authorization": f"Api-Key {settings.yandex_api_key}"}

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(TTS_URL, data=data, headers=headers)
        response.raise_for_status()
        audio = response.content

    logger.info("TTS синтезировал %d байт аудио", len(audio))
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
