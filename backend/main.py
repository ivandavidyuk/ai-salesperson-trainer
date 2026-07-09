"""Точка входа FastAPI WebSocket-сервера голосового ИИ-тренажёра.

Эндпоинт WS /ws/session/{session_id} реализует голосовой пайплайн:
    клиент -> (audio_chunk) -> STT -> LLM -> TTS -> (audio_chunk) -> клиент

Запуск (из папки backend):
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import asyncio
import base64
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from services import llm, tts
from services.session import (
    STATUS_ACTIVE,
    STATUS_COMPLETED,
    STATUS_PAUSED,
    SessionStore,
)
from services.stt import ElevenLabsSTT

# Логирование каждого шага пайплайна
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger("ws-server")

# Единое хранилище состояния сессий (Redis + PostgreSQL)
store = SessionStore()

# Знаки конца предложения для нарезки LLM-стрима под TTS
_SENTENCE_ENDINGS = ".!?…"

# Минимальная длина предложения (симв.): слишком короткие обрывки
# («Ну.») склеиваем со следующим предложением, чтобы TTS не звучал рвано
_MIN_SENTENCE_LEN = 20


def split_first_sentence(text: str) -> tuple[str | None, str]:
    """Отрезает первое законченное предложение от буфера LLM-стрима.

    Возвращает (предложение, остаток). Если законченного предложения
    достаточной длины ещё нет — (None, исходный текст).
    """
    for i, ch in enumerate(text):
        if ch not in _SENTENCE_ENDINGS:
            continue
        # Захватываем повторяющуюся пунктуацию («?!», «...») целиком
        end = i + 1
        while end < len(text) and text[end] in _SENTENCE_ENDINGS:
            end += 1
        # Многоточие в середине числа/сокращения не режем: требуем после
        # пунктуации пробел или конец буфера
        if end < len(text) and not text[end].isspace():
            continue
        sentence = text[:end].strip()
        if len(sentence) < _MIN_SENTENCE_LEN:
            continue
        return sentence, text[end:]
    return None, text


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и закрытие подключений на старте/остановке сервера."""
    await store.connect()
    logger.info("Сервер запущен")
    yield
    await store.close()
    logger.info("Сервер остановлен")


app = FastAPI(title="AI Salesperson Trainer — WS Server", lifespan=lifespan)


@app.get("/health")
async def health():
    """Простой healthcheck."""
    return {"status": "ok"}


async def safe_send(ws: WebSocket, message: dict) -> None:
    """Отправляет сообщение клиенту, не падая при закрытом соединении."""
    try:
        await ws.send_json(message)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось отправить сообщение клиенту: %s", exc)


@app.websocket("/ws/session/{session_id}")
async def session_ws(ws: WebSocket, session_id: str):
    """WebSocket-эндпоинт одной тренировочной сессии."""
    await ws.accept()

    # 1. Проверяем одноразовый ws-токен из query-параметра ?token=...
    # Токен одноразовый: consume_ws_token удаляет его из Redis при проверке.
    ws_token = ws.query_params.get("token")
    user_id = await store.consume_ws_token(ws_token)
    if user_id is None:
        logger.info(
            "Сессия %s: отклонена (ws-токен не найден или истёк)", session_id
        )
        # По ТЗ: токен не найден/истёк — закрываем с кодом 4001
        await ws.close(code=4001)
        return

    # 2. Загружаем состояние сессии и проверяем, что она принадлежит юзеру
    status = await store.load_session(session_id)
    if status is None:
        logger.info("Сессия %s: не найдена", session_id)
        await safe_send(ws, {"type": "error", "message": "Сессия не найдена"})
        await ws.close(code=1008)
        return

    owner = await store.get_session_owner(session_id)
    if owner != user_id:
        logger.info(
            "Сессия %s: доступ запрещён (владелец=%s, токен=%s)",
            session_id,
            owner,
            user_id,
        )
        await safe_send(ws, {"type": "error", "message": "Доступ запрещён"})
        await ws.close(code=1008)
        return

    if status != STATUS_ACTIVE:
        logger.info("Сессия %s: статус=%s, отклонено", session_id, status)
        await safe_send(ws, {"type": "error", "message": "Сессия не активна"})
        await ws.close(code=1008)
        return

    logger.info(
        "Сессия %s: подключение установлено (user=%s)", session_id, user_id
    )

    # Постоянный TTS WebSocket на всю сессию: соединение устанавливается
    # здесь один раз, чтобы на каждой реплике не тратить время на TLS
    tts_stream = tts.TtsWsStream()
    try:
        await tts_stream.start()
    except Exception as exc:  # noqa: BLE001
        # Не критично: stream_sentence переподключится, а при повторном
        # сбое сработает HTTP-фолбэк в консьюмере
        logger.warning("TTS: не удалось открыть WebSocket заранее: %s", exc)

    # 3. Колбэк, запускающий конвейер LLM -> TTS при финальном STT-результате.
    # LLM стримит токены; готовые предложения сразу уходят в TTS-stream
    # и к клиенту (каждое предложение — отдельный audio_end), поэтому
    # первое предложение звучит, пока LLM догенерирует остальное.
    async def handle_user_text(text: str) -> None:
        try:
            t_start = time.perf_counter()
            # Распознанная реплика менеджера
            await safe_send(ws, {"type": "transcript_user", "text": text})
            # Первичная запись — PostgreSQL (RU): стартует сразу, но фоном,
            # чтобы межстрановая задержка не тормозила LLM
            asyncio.create_task(store.persist_message(session_id, "user", text))
            # Контекст для LLM — локальный Redis-кэш (~1 мс)
            await store.append_message_cache(session_id, "user", text)

            history = await store.get_messages(session_id)

            # Очередь предложений между LLM (producer) и TTS (consumer);
            # None — маркер конца стрима
            sentences: asyncio.Queue[str | None] = asyncio.Queue()

            async def produce_sentences() -> str:
                """Читает LLM-стрим, кладёт предложения в очередь, возвращает весь ответ."""
                buffer = ""
                full_reply = ""
                try:
                    async for delta in llm.stream_reply(history):
                        buffer += delta
                        full_reply += delta
                        # Вырезаем из буфера готовые предложения
                        while True:
                            sentence, rest = split_first_sentence(buffer)
                            if sentence is None:
                                break
                            buffer = rest
                            await sentences.put(sentence)
                    # Остаток без завершающей пунктуации тоже озвучиваем
                    tail = buffer.strip()
                    if tail:
                        await sentences.put(tail)
                finally:
                    await sentences.put(None)
                return full_reply.strip()

            first_audio_ms: float | None = None

            async def synthesize_sentence(sentence: str) -> AsyncIterator[bytes]:
                """Постоянный WS-канал TTS; при сбое — HTTP-фолбэк."""
                got_audio = False
                try:
                    async for chunk in tts_stream.stream_sentence(sentence):
                        got_audio = True
                        yield chunk
                except Exception as exc:  # noqa: BLE001
                    if got_audio:
                        # Часть предложения уже ушла клиенту — повторный
                        # синтез продублировал бы речь
                        raise
                    logger.warning(
                        "TTS WS не сработал (%s), фолбэк на HTTP", exc
                    )
                    async for chunk in tts.synthesize_stream(sentence):
                        yield chunk

            async def consume_sentences() -> None:
                """Синтезирует предложения по очереди и стримит аудио клиенту."""
                nonlocal first_audio_ms
                while True:
                    sentence = await sentences.get()
                    if sentence is None:
                        break
                    async for chunk in synthesize_sentence(sentence):
                        if first_audio_ms is None:
                            first_audio_ms = (time.perf_counter() - t_start) * 1000
                        await safe_send(
                            ws,
                            {
                                "type": "audio_chunk",
                                "data": base64.b64encode(chunk).decode("ascii"),
                            },
                        )
                    # Маркер конца предложения: клиент собирает MP3 и ставит
                    # его в очередь воспроизведения
                    await safe_send(ws, {"type": "audio_end"})

            producer = asyncio.create_task(produce_sentences())
            await consume_sentences()
            reply = await producer

            await safe_send(ws, {"type": "transcript_ai", "text": reply})
            # Кэш — синхронно (дёшево), Postgres — фоном
            await store.append_message_cache(session_id, "assistant", reply)
            asyncio.create_task(
                store.persist_message(session_id, "assistant", reply)
            )

            total_ms = (time.perf_counter() - t_start) * 1000
            logger.info(
                "ТАЙМИНГ сессия %s: до первого аудио=%.0f мс, всего(после STT)=%.0f мс",
                session_id,
                first_audio_ms if first_audio_ms is not None else -1,
                total_ms,
            )
        except Exception as exc:  # noqa: BLE001
            # Любой сбой шага не роняет сервер — сообщаем клиенту
            logger.error("Ошибка пайплайна (сессия %s): %s", session_id, exc)
            await safe_send(
                ws,
                {"type": "error", "message": f"Ошибка обработки: {exc}"},
            )

    # 4. Инициализируем STT (ElevenLabs Realtime)
    from core.config import get_settings

    api_key = get_settings().elevenlabs_api_key
    stt = ElevenLabsSTT(api_key=api_key, on_final=handle_user_text)
    stt_started = False
    try:
        await stt.start()
        stt_started = True
    except Exception as exc:  # noqa: BLE001
        logger.error("Не удалось запустить STT (сессия %s): %s", session_id, exc)
        await safe_send(
            ws,
            {"type": "error", "message": "Распознавание речи недоступно"},
        )

    # 5. Основной цикл приёма сообщений от клиента
    try:
        while True:
            message = await ws.receive_json()
            msg_type = message.get("type")

            if msg_type == "audio_chunk":
                # Обрабатываем аудио только в активном состоянии
                current = await store.get_status(session_id)
                if current != STATUS_ACTIVE:
                    continue
                if not stt_started:
                    continue
                try:
                    raw = base64.b64decode(message.get("data", ""))
                    await stt.push_audio(raw)
                except Exception as exc:  # noqa: BLE001
                    logger.error("Ошибка декодирования аудио: %s", exc)
                    await safe_send(
                        ws,
                        {"type": "error", "message": "Некорректный аудио-чанк"},
                    )

            elif msg_type == "pause":
                await store.set_status(session_id, STATUS_PAUSED)
                logger.info("Сессия %s: пауза", session_id)

            elif msg_type == "resume":
                await store.set_status(session_id, STATUS_ACTIVE)
                logger.info("Сессия %s: возобновлена", session_id)

            elif msg_type == "stop":
                logger.info("Сессия %s: остановка", session_id)
                await store.set_status(session_id, STATUS_COMPLETED)
                await store.clear_session(session_id)
                await safe_send(ws, {"type": "session_ended"})
                break

            else:
                logger.warning(
                    "Сессия %s: неизвестный тип сообщения %r",
                    session_id,
                    msg_type,
                )

    except WebSocketDisconnect:
        logger.info("Сессия %s: клиент отключился", session_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Сессия %s: непредвиденная ошибка: %s", session_id, exc)
        await safe_send(ws, {"type": "error", "message": "Внутренняя ошибка"})
    finally:
        # 6. Корректно закрываем STT, TTS и соединение
        if stt_started:
            try:
                await stt.stop()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Ошибка при остановке STT: %s", exc)
        try:
            await tts_stream.stop()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Ошибка при остановке TTS: %s", exc)
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
        logger.info("Сессия %s: соединение закрыто", session_id)
