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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from services import llm, tts
from services.session import (
    STATUS_ACTIVE,
    STATUS_COMPLETED,
    STATUS_PAUSED,
    SessionStore,
)
from services.stt import YandexSTT

# Логирование каждого шага пайплайна
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger("ws-server")

# Единое хранилище состояния сессий (Redis + PostgreSQL)
store = SessionStore()


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

    # 3. Колбэк, запускающий цепочку LLM -> TTS при финальном STT-результате
    async def handle_user_text(text: str) -> None:
        try:
            t_start = time.perf_counter()
            # Распознанная реплика менеджера
            await safe_send(ws, {"type": "transcript_user", "text": text})
            await store.append_message(session_id, "user", text)

            # LLM: ответ клиента
            history = await store.get_messages(session_id)
            t_llm = time.perf_counter()
            reply = await llm.generate_reply(history)
            llm_ms = (time.perf_counter() - t_llm) * 1000
            await safe_send(ws, {"type": "transcript_ai", "text": reply})
            await store.append_message(session_id, "assistant", reply)

            # TTS: озвучка ответа, отправляем чанками
            t_tts = time.perf_counter()
            audio = await tts.synthesize(reply)
            tts_ms = (time.perf_counter() - t_tts) * 1000
            for chunk in tts.chunk_audio(audio):
                await safe_send(
                    ws,
                    {
                        "type": "audio_chunk",
                        "data": base64.b64encode(chunk).decode("ascii"),
                    },
                )
            # Маркер конца аудио: клиент собирает OGG целиком и проигрывает
            await safe_send(ws, {"type": "audio_end"})
            total_ms = (time.perf_counter() - t_start) * 1000
            # Разбивка задержки по этапам: видно, что именно тормозит
            logger.info(
                "ТАЙМИНГ сессия %s: LLM=%.0f мс, TTS=%.0f мс, всего(после STT)=%.0f мс",
                session_id,
                llm_ms,
                tts_ms,
                total_ms,
            )
        except Exception as exc:  # noqa: BLE001
            # Любой сбой шага не роняет сервер — сообщаем клиенту
            logger.error("Ошибка пайплайна (сессия %s): %s", session_id, exc)
            await safe_send(
                ws,
                {"type": "error", "message": f"Ошибка обработки: {exc}"},
            )

    # 4. Инициализируем STT (если SpeechKit доступен)
    from core.config import get_settings

    api_key = get_settings().yandex_api_key
    stt = YandexSTT(api_key=api_key, on_final=handle_user_text)
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
        # 6. Корректно закрываем STT и соединение
        if stt_started:
            try:
                await stt.stop()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Ошибка при остановке STT: %s", exc)
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
        logger.info("Сессия %s: соединение закрыто", session_id)
