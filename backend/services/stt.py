"""STT — потоковое распознавание речи через Yandex SpeechKit (gRPC v3).

Принимает аудио-чанки (PCM 16kHz mono), стримит их в Yandex SpeechKit
Streaming Recognition и при получении финального результата вызывает
переданный колбэк on_final(text).

gRPC-стабы берутся из пакета yandexcloud (yandex.cloud.ai.stt.v3).
Если пакет недоступен, сервис помечается как недоступный, но импорт модуля
не падает — это позволяет запускать остальной сервер без SpeechKit.
"""

import asyncio
import logging
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

# Адрес gRPC-эндпоинта Yandex SpeechKit
STT_ENDPOINT = "stt.api.cloud.yandex.net:443"

# Пытаемся импортировать gRPC-стабы. Если не вышло — STT недоступен.
try:
    import grpc
    from yandex.cloud.ai.stt.v3 import stt_pb2, stt_service_pb2_grpc

    STT_AVAILABLE = True
except Exception as exc:  # noqa: BLE001
    STT_AVAILABLE = False
    _IMPORT_ERROR = exc
    logger.warning("STT недоступен (нет gRPC-стабов SpeechKit): %s", exc)


# Тип колбэка: получает финальный распознанный текст
OnFinal = Callable[[str], Awaitable[None]]


class YandexSTT:
    """Управляет одной потоковой сессией распознавания речи."""

    def __init__(self, api_key: str, on_final: OnFinal) -> None:
        self._api_key = api_key
        self._on_final = on_final
        self._audio_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._channel = None  # type: ignore[var-annotated]
        self._closed = False

    async def _request_iterator(self):
        """Генератор запросов: сначала параметры сессии, затем аудио-чанки."""
        # Параметры распознавания: PCM 16kHz mono, русский язык, реальное время
        recognize_options = stt_pb2.StreamingOptions(
            recognition_model=stt_pb2.RecognitionModelOptions(
                audio_format=stt_pb2.AudioFormatOptions(
                    raw_audio=stt_pb2.RawAudio(
                        audio_encoding=stt_pb2.RawAudio.LINEAR16_PCM,
                        sample_rate_hertz=16000,
                        audio_channel_count=1,
                    )
                ),
                text_normalization=stt_pb2.TextNormalizationOptions(
                    text_normalization=stt_pb2.TextNormalizationOptions.TEXT_NORMALIZATION_ENABLED,
                    profanity_filter=False,
                    literature_text=False,
                ),
                language_restriction=stt_pb2.LanguageRestrictionOptions(
                    restriction_type=stt_pb2.LanguageRestrictionOptions.WHITELIST,
                    language_code=["ru-RU"],
                ),
                audio_processing_type=stt_pb2.RecognitionModelOptions.REAL_TIME,
            )
        )
        yield stt_pb2.StreamingRequest(session_options=recognize_options)

        # Далее — аудио из очереди, пока не получим сигнал завершения (None)
        while True:
            chunk = await self._audio_queue.get()
            if chunk is None:
                break
            yield stt_pb2.StreamingRequest(
                chunk=stt_pb2.AudioChunk(data=chunk)
            )

    async def start(self) -> None:
        """Открывает gRPC-соединение и запускает фоновую обработку ответов."""
        if not STT_AVAILABLE:
            raise RuntimeError(
                f"SpeechKit STT недоступен: {_IMPORT_ERROR}"
            )
        if not self._api_key:
            raise RuntimeError("Не задан YANDEX_API_KEY для STT")

        self._channel = grpc.aio.secure_channel(
            STT_ENDPOINT, grpc.ssl_channel_credentials()
        )
        stub = stt_service_pb2_grpc.RecognizerStub(self._channel)
        metadata = (("authorization", f"Api-Key {self._api_key}"),)
        self._task = asyncio.create_task(self._consume(stub, metadata))
        logger.info("STT: gRPC-стрим запущен")

    async def _consume(self, stub, metadata) -> None:
        """Читает ответы распознавания и вызывает колбэк на финальных фразах."""
        try:
            responses = stub.RecognizeStreaming(
                self._request_iterator(), metadata=metadata
            )
            async for response in responses:
                event = response.WhichOneof("Event")
                # final / final_refinement содержат финальный текст
                if event in ("final", "final_refinement"):
                    container = (
                        response.final
                        if event == "final"
                        else response.final_refinement.normalized_text
                    )
                    text = " ".join(
                        alt.text for alt in container.alternatives
                    ).strip()
                    if text:
                        logger.info("STT финальный результат: %s", text)
                        await self._on_final(text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Ошибка STT-стрима: %s", exc)
            raise

    async def push_audio(self, data: bytes) -> None:
        """Передаёт очередной аудио-чанк в распознавание."""
        if self._closed:
            return
        await self._audio_queue.put(data)

    async def stop(self) -> None:
        """Завершает поток распознавания и закрывает соединение."""
        if self._closed:
            return
        self._closed = True
        await self._audio_queue.put(None)  # сигнал завершения генератору

        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            except Exception as exc:  # noqa: BLE001
                logger.warning("STT: ошибка при завершении: %s", exc)

        if self._channel is not None:
            await self._channel.close()
        logger.info("STT: остановлен")
