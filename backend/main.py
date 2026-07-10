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
from typing import AsyncIterator, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from core.config import get_settings
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

# Оценка скорости воспроизведения у клиента: TTS отдаёт MP3 64 кбит/с,
# то есть ~8000 байт аудио на секунду звука
_MP3_BYTES_PER_SEC = 8000

# Фильтр фантомных коммитов STT применяется только к коротким репликам
_SHORT_COMMIT_MAX_WORDS = 2

# Окно после предполагаемого конца воспроизведения, в котором короткий
# коммит из слов ответа ИИ ещё считается эхом из динамиков
_ECHO_GRACE_SECS = 1.0

# Перезапуск отменённого хода: если после голоса-отмены столько секунд
# нет ни голоса, ни коммита — голос был шумом, отвечаем на прежний текст
_NOISE_RESTART_SILENCE_SECS = 1.2
_NOISE_RESTART_POLL_SECS = 0.5

# Пунктуация, отбрасываемая при нормализации слов для фильтра фантомов
_WORD_STRIP_CHARS = ".,!?…:;«»\"'()—–-"


def _norm_words(text: str) -> list[str]:
    """Нормализует текст в список слов без пунктуации и регистра."""
    words = []
    for raw in text.lower().split():
        word = raw.strip(_WORD_STRIP_CHARS)
        if word:
            words.append(word)
    return words


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


class TurnManager:
    """Оркестратор ходов диалога поверх STT-коммитов.

    Решает три задачи:
    - фильтрует фантомные коммиты: граничные дубли (пере-декодированный
      хвост предыдущей фразы) и эхо ответа ИИ из динамиков;
    - делает пайплайн LLM→TTS отменяемым: если менеджер продолжил говорить
      после раннего семантического коммита, недоигранный ход отменяется,
      а фрагменты фразы склеиваются в одну реплику;
    - barge-in: устойчивый громкий голос менеджера во время речи ИИ
      обрывает ответ, клиент сбрасывает буфер воспроизведения.
    """

    def __init__(self, ws: WebSocket, session_id: str, tts_stream: "tts.TtsWsStream") -> None:
        self.ws = ws
        self.session_id = session_id
        self.tts_stream = tts_stream
        # Проставляется после создания ElevenLabsSTT (нужен seconds_since_voice)
        self.stt: Optional[ElevenLabsSTT] = None
        self.barge_in_enabled = get_settings().barge_in_enabled

        self.task: Optional[asyncio.Task] = None  # активный пайплайн
        self.current_text = ""          # реплика менеджера активного хода
        self.audio_started = False      # первый аудио-чанк уже ушёл клиенту
        self.sent_sentences: list[str] = []  # предложения, ушедшие целиком
        self.stash = ""      # фрагмент фразы отменённого хода (ждёт склейки)
        self.pending = ""    # коммиты, пришедшие пока ИИ говорил
        self.restart_task: Optional[asyncio.Task] = None

        # Данные для фильтра фантомных коммитов
        self.last_user_text = ""        # последняя завершённая реплика менеджера
        self.reply_words: set[str] = set()  # слова уже озвученного ответа ИИ
        self.playback_end = 0.0  # оценка, когда клиент доиграет буфер (monotonic)

    # --- Колбэки STT ------------------------------------------------------

    async def on_final(self, text: str) -> None:
        """Обрабатывает зафиксированную реплику менеджера (не блокируя STT)."""
        if self._is_phantom(text):
            return
        self._cancel_restart_timer()

        # Склейка: stash — фрагмент отменённого хода, pending — реплики,
        # накопившиеся пока ИИ говорил
        parts = [p for p in (self.stash, self.pending, text) if p]
        self.stash = ""
        self.pending = ""
        text = " ".join(parts)

        if self.task is not None and not self.task.done():
            if not self.audio_started:
                # Продолжение фразы догнало пайплайн до первого звука
                # (голос-отмена не успела: тихая речь) — склеиваем и заново
                merged = f"{self.current_text} {text}"
                logger.info(
                    "Сессия %s: склейка разрезанной фразы: %s",
                    self.session_id,
                    merged,
                )
                await self._cancel_active()
                self._start(merged)
            else:
                # ИИ уже говорит — реплика подождёт завершения текущего хода
                self.pending = text
        else:
            self._start(text)

    async def on_voice_resumed(self) -> None:
        """Голос после тишины: возможно, менеджер продолжает разрезанную фразу."""
        if self.task is None or self.task.done() or self.audio_started:
            return
        logger.info(
            "Сессия %s: голос во время пайплайна — отмена хода, фрагмент: %s",
            self.session_id,
            self.current_text,
        )
        fragment = self.current_text
        await self._cancel_active()
        self.stash = fragment
        self._cancel_restart_timer()
        self.restart_task = asyncio.create_task(self._restart_if_noise())

    async def on_sustained_voice(self) -> None:
        """Устойчивый громкий голос во время речи ИИ — barge-in."""
        if not self.barge_in_enabled:
            return
        if self.task is not None and not self.task.done() and self.audio_started:
            # Перебивание во время генерации: обрываем пайплайн, в историю
            # идёт только та часть ответа, которая успела прозвучать
            spoken = " ".join(self.sent_sentences)
            user_text = self.current_text
            await self._cancel_active()
            await safe_send(self.ws, {"type": "barge_in"})
            self.playback_end = 0.0
            logger.info(
                "Сессия %s: barge-in, ответ оборван (озвучено предложений: %d)",
                self.session_id,
                len(self.sent_sentences),
            )
            await store.append_message_cache(self.session_id, "user", user_text)
            asyncio.create_task(
                store.persist_message(self.session_id, "user", user_text)
            )
            self.last_user_text = user_text
            if spoken:
                await safe_send(self.ws, {"type": "transcript_ai", "text": spoken})
                await store.append_message_cache(
                    self.session_id, "assistant", spoken
                )
                asyncio.create_task(
                    store.persist_message(self.session_id, "assistant", spoken)
                )
        elif time.monotonic() < self.playback_end:
            # Пайплайн завершён, но клиент ещё доигрывает буфер — сбрасываем
            # только воспроизведение (история уже записана целиком)
            await safe_send(self.ws, {"type": "barge_in"})
            self.playback_end = 0.0
            logger.info(
                "Сессия %s: barge-in на доигрывании буфера", self.session_id
            )

    async def shutdown(self) -> None:
        """Останавливает активный пайплайн при закрытии сессии."""
        self._cancel_restart_timer()
        await self._cancel_active()

    # --- Внутренности -----------------------------------------------------

    def _is_phantom(self, text: str) -> bool:
        """Отбрасывает короткие фантомные коммиты (дубли границы и эхо)."""
        words = _norm_words(text)
        if not words or len(words) > _SHORT_COMMIT_MAX_WORDS:
            return False
        # Граничный дубль: ElevenLabs после принудительного коммита
        # пере-декодирует хвост буфера («...зовут Иван» → «Иван»)
        for prev in (self.stash, self.current_text, self.last_user_text):
            prev_words = _norm_words(prev)
            if prev_words and prev_words[-len(words):] == words:
                logger.info(
                    "Сессия %s: отброшен граничный дубль %r (хвост %r)",
                    self.session_id,
                    text,
                    prev,
                )
                return True
        # Эхо: все слова коммита есть в озвученном ответе ИИ, и ответ ещё
        # звучит (или только что отзвучал)
        if self.reply_words and all(w in self.reply_words for w in words):
            if time.monotonic() < self.playback_end + _ECHO_GRACE_SECS:
                logger.info(
                    "Сессия %s: отброшен коммит-эхо %r", self.session_id, text
                )
                return True
        return False

    def _cancel_restart_timer(self) -> None:
        if self.restart_task is not None and not self.restart_task.done():
            self.restart_task.cancel()
        self.restart_task = None

    async def _cancel_active(self) -> None:
        """Отменяет активный пайплайн и дожидается его завершения."""
        task = self.task
        self.task = None
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            pass

    async def _restart_if_noise(self) -> None:
        """Защита от зависания после голоса-отмены.

        Если голос оказался шумом без речи, коммита не будет и склейка не
        случится. Когда голоса нет дольше порога (VAD зафиксировал бы речь
        за 0.65 с), а stash так и не забрали — отвечаем на прежний текст.
        """
        try:
            while True:
                await asyncio.sleep(_NOISE_RESTART_POLL_SECS)
                if not self.stash:
                    return
                if (
                    self.stt is not None
                    and self.stt.seconds_since_voice < _NOISE_RESTART_SILENCE_SECS
                ):
                    continue  # менеджер ещё говорит — ждём коммит
                text, self.stash = self.stash, ""
                logger.info(
                    "Сессия %s: коммита после отмены не было, перезапуск: %s",
                    self.session_id,
                    text,
                )
                self._start(text)
                return
        except asyncio.CancelledError:
            pass

    def _start(self, text: str) -> None:
        """Запускает пайплайн LLM→TTS отдельной отменяемой задачей."""
        self.current_text = text
        self.audio_started = False
        self.sent_sentences = []
        self.reply_words = set()
        self.task = asyncio.create_task(self._run(text))

    async def _run(self, text: str) -> None:
        """Пайплайн одного хода: LLM-стрим → нарезка → TTS → клиент.

        История пишется только при успешном завершении: отменённый ход не
        оставляет следов в Redis/Postgres, склеенная фраза сохраняется
        одним сообщением.
        """
        ws = self.ws
        session_id = self.session_id
        producer: Optional[asyncio.Task] = None
        try:
            t_start = time.perf_counter()
            await safe_send(ws, {"type": "transcript_user", "text": text})

            # Контекст: история из Redis-кэша + текущая (ещё не записанная)
            # реплика менеджера
            history = await store.get_messages(session_id)
            history.append({"role": "user", "text": text})

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
                    async for chunk in self.tts_stream.stream_sentence(sentence):
                        got_audio = True
                        yield chunk
                except asyncio.CancelledError:
                    raise
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
                        self.audio_started = True
                        # Оценка, когда клиент доиграет отправленное аудио
                        # (для barge-in и фильтра эха)
                        now = time.monotonic()
                        self.playback_end = (
                            max(self.playback_end, now)
                            + len(chunk) / _MP3_BYTES_PER_SEC
                        )
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
                    # Предложение прозвучит целиком — учитываем его для
                    # усечённой истории barge-in и фильтра эха
                    self.sent_sentences.append(sentence)
                    self.reply_words.update(_norm_words(sentence))

            producer = asyncio.create_task(produce_sentences())
            await consume_sentences()
            reply = await producer

            await safe_send(ws, {"type": "transcript_ai", "text": reply})
            # Успешное завершение хода — фиксируем историю:
            # кэш синхронно (дёшево, Redis локальный), Postgres фоном
            await store.append_message_cache(session_id, "user", text)
            asyncio.create_task(store.persist_message(session_id, "user", text))
            await store.append_message_cache(session_id, "assistant", reply)
            asyncio.create_task(
                store.persist_message(session_id, "assistant", reply)
            )
            self.last_user_text = text

            total_ms = (time.perf_counter() - t_start) * 1000
            logger.info(
                "ТАЙМИНГ сессия %s: до первого аудио=%.0f мс, всего(после STT)=%.0f мс",
                session_id,
                first_audio_ms if first_audio_ms is not None else -1,
                total_ms,
            )

            # Реплики, пришедшие пока ИИ говорил, — следующий ход
            if self.pending:
                next_text, self.pending = self.pending, ""
                self._start(next_text)
        except asyncio.CancelledError:
            logger.info(
                "Сессия %s: пайплайн отменён (текст: %s)", session_id, text
            )
            raise
        except Exception as exc:  # noqa: BLE001
            # Любой сбой шага не роняет сервер — сообщаем клиенту
            logger.error("Ошибка пайплайна (сессия %s): %s", session_id, exc)
            await safe_send(
                ws,
                {"type": "error", "message": f"Ошибка обработки: {exc}"},
            )
        finally:
            if producer is not None and not producer.done():
                producer.cancel()


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

    # 3. Менеджер ходов: получает STT-коммиты, фильтрует фантомы, запускает
    # отменяемый пайплайн LLM -> TTS (склейка разрезанных фраз, barge-in).
    manager = TurnManager(ws=ws, session_id=session_id, tts_stream=tts_stream)

    # 4. Инициализируем STT (ElevenLabs Realtime)
    api_key = get_settings().elevenlabs_api_key
    stt = ElevenLabsSTT(
        api_key=api_key,
        on_final=manager.on_final,
        on_voice_resumed=manager.on_voice_resumed,
        on_sustained_voice=manager.on_sustained_voice,
    )
    manager.stt = stt
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
        # 6. Корректно закрываем пайплайн, STT, TTS и соединение
        try:
            await manager.shutdown()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Ошибка при остановке пайплайна: %s", exc)
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
