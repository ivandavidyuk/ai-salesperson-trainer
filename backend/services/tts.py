"""TTS — синтез речи через Yandex SpeechKit (API v3, gRPC).

Принимает текст, синтезирует его голосом marina (амплуа neutral),
возвращает аудио в формате OGG (opus) и нарезает его на чанки.
"""

import logging
from typing import AsyncIterator, Iterator

import grpc
from yandex.cloud.ai.tts.v3 import tts_pb2, tts_service_pb2_grpc

from core.config import get_settings

logger = logging.getLogger(__name__)

# gRPC-эндпоинт синтеза речи (v3)
TTS_ENDPOINT = "tts.api.cloud.yandex.net:443"

# Голос и амплуа
TTS_VOICE = "marina"
TTS_ROLE = "neutral"

# Размер аудио-чанка для отправки клиенту (в байтах)
CHUNK_SIZE = 16 * 1024


async def synthesize(text: str) -> bytes:
    """Синтезирует речь и возвращает аудио целиком (OGG/opus) через v3 gRPC."""
    settings = get_settings()
    if not settings.yandex_api_key:
        raise RuntimeError("Не задан YANDEX_API_KEY для TTS")

    request = tts_pb2.UtteranceSynthesisRequest(
        text=text,
        # Голос marina + амплуа neutral (каждая подсказка — отдельный Hints)
        hints=[
            tts_pb2.Hints(voice=TTS_VOICE),
            tts_pb2.Hints(role=TTS_ROLE),
        ],
        output_audio_spec=tts_pb2.AudioFormatOptions(
            container_audio=tts_pb2.ContainerAudio(
                container_audio_type=tts_pb2.ContainerAudio.OGG_OPUS
            )
        ),
        loudness_normalization_type=tts_pb2.UtteranceSynthesisRequest.LUFS,
        # По умолчанию v3 синтезирует не длиннее 250 символов. Ответ клиента
        # бывает длиннее — unsafe_mode снимает лимит (до 5000 символов).
        unsafe_mode=True,
    )

    metadata = [("authorization", f"Api-Key {settings.yandex_api_key}")]
    if settings.yandex_folder_id:
        metadata.append(("x-folder-id", settings.yandex_folder_id))

    async with grpc.aio.secure_channel(
        TTS_ENDPOINT, grpc.ssl_channel_credentials()
    ) as channel:
        stub = tts_service_pb2_grpc.SynthesizerStub(channel)
        responses = stub.UtteranceSynthesis(request, metadata=metadata)
        chunks: list[bytes] = []
        async for response in responses:
            chunks.append(response.audio_chunk.data)

    audio = b"".join(chunks)
    logger.info("TTS синтезировал %d байт аудио (голос %s)", len(audio), TTS_VOICE)
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
