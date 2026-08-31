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

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect

from core.auth import verify_token
from core.config import get_settings
from services import achievements, case_generator, diagnostics, llm, scoring, tts
from services.text import strip_for_speech
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
# Столько ходов без единой оценки — считаем фоновый оценщик сломанным
# и перестаём применять порог. Иначе его молчаливый отказ сделал бы сделку
# незакрываемой, а это ровно тот баг, который мы чиним
_SCORER_BROKEN_AFTER_TURNS = 12

_NOISE_RESTART_SILENCE_SECS = 1.2
_NOISE_RESTART_POLL_SECS = 0.5

# Barge-in по partial: сколько секунд назад во входящем аудио должен был
# звучать реальный голос, чтобы partial-транскрипт считался речью менеджера,
# а не галлюцинацией Scribe на тишине
_PARTIAL_VOICE_MAX_AGE_SECS = 1.5

# Пунктуация, отбрасываемая при нормализации слов для фильтра фантомов
_WORD_STRIP_CHARS = ".,!?…:;«»\"'()—–-"

# Поддакивания: короткие подтверждения, которыми менеджер показывает, что
# слушает, — они не должны перебивать ИИ и не должны порождать его ответ.
# Осознанно НЕ включаем слова-команды перебивания (см. _INTERRUPT_COMMANDS).
_BACKCHANNEL_WORDS = {
    # Нелексические звуки (STT пишет их нестабильно)
    "угу", "ага", "аг", "мгм", "угм", "ммхм", "мхм", "нгм",
    "мм", "ммм", "м", "хм", "хмм",
    "э", "эм", "ээ", "а", "аа",
    # Слова-подтверждения («принял, слушаю») — не турн и не перебивание.
    # «понял» подтверждён логами: STT часто выдаёт «угу» как «понял»/«понял понял».
    "да", "так", "ну", "вот",
    "ок", "окей",
    "понятно", "ясно", "понял", "поняла", "поняли",
    "ладно", "хорошо", "точно", "конечно", "верно", "именно",
}

# «Мычащие» звуки STT пишет нестабильно: один и тот же нелексический звук —
# то «мгм», то «мхм», то «нгм». Короткий токен только из этих букв тоже
# считаем поддакиванием, чтобы не зависеть от точного написания.
_MUMBLE_LETTERS = set("мгхуэн")
_MUMBLE_MAX_LEN = 4

# Явные команды-перебивания: одного такого слова достаточно, чтобы оборвать
# ИИ, даже если оно единственное распознанное. НЕ входят в _BACKCHANNEL_WORDS.
_INTERRUPT_COMMANDS = {
    "стоп", "стой", "стойте",
    "подожди", "подождите", "погоди", "погодите",
    "секунду", "секундочку", "минуту", "минутку", "минуточку",
    "извините", "извини", "простите", "прости", "извиняюсь",
}

# Barge-in: минимум осмысленных слов для перебивания. Порог 2 (а не 1)
# защищает от единичного шумно-распознанного звука («мгм» → «него»);
# одиночная команда из _INTERRUPT_COMMANDS перебивает в обход порога.
_BARGE_IN_MIN_MEANINGFUL_WORDS = 2


def _norm_words(text: str) -> list[str]:
    """Нормализует текст в список слов без пунктуации и регистра."""
    words = []
    for raw in text.lower().split():
        word = raw.strip(_WORD_STRIP_CHARS)
        if word:
            words.append(word)
    return words


def _collapse_repeats(word: str) -> str:
    """Схлопывает подряд идущие повторы буквы: «дааа» → «да», «ммм» → «м»."""
    out: list[str] = []
    for ch in word:
        if not out or out[-1] != ch:
            out.append(ch)
    return "".join(out)


def _is_backchannel_token(word: str) -> bool:
    """Токен целиком поддакивающий: слово из списка, короткий «мычащий» звук
    или их повтор через дефис («да-да», «угу-угу»). Удлинения схлопываем."""
    parts = [p for p in word.split("-") if p]
    if not parts:
        return False
    for part in parts:
        if part in _BACKCHANNEL_WORDS or _collapse_repeats(part) in _BACKCHANNEL_WORDS:
            continue
        if len(part) <= _MUMBLE_MAX_LEN and all(ch in _MUMBLE_LETTERS for ch in part):
            continue
        return False
    return True


def _meaningful_words(text: str) -> list[str]:
    """Слова с осмысленным содержанием (без поддакиваний)."""
    return [w for w in _norm_words(text) if not _is_backchannel_token(w)]


def _is_backchannel_only(text: str) -> bool:
    """Реплика состоит только из поддакиваний (непустая, но без смысла)."""
    return bool(_norm_words(text)) and not _meaningful_words(text)


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

    # Фоновый оценщик ходит в модель после каждого хода и с включённым
    # размышлением, параллельно живому разговору. Стоя на одной модели
    # с ролью, он забивает её лимит: половина оценок теряется на 429,
    # а задержка разговора вырастает в разы. Симптом неочевидный —
    # падает не оценщик, а голос, — поэтому говорим прямо.
    #
    # Итогового оценщика это не касается: он работает после конца разговора
    # и конкурировать с ролью не может.
    settings = get_settings()
    if settings.scorer_model == settings.llm_model:
        logger.warning(
            "SCORER_MODEL совпадает с LLM_MODEL (%s): фоновый оценщик и роль "
            "делят один лимит провайдера — ждите 429 и просадку задержки",
            settings.llm_model,
        )
    logger.info(
        "Модели: роль %s | фоновый оценщик %s | итоговый %s",
        settings.llm_model,
        settings.scorer_model,
        settings.final_scorer_model,
    )

    logger.info("Сервер запущен")
    yield
    await store.close()
    logger.info("Сервер остановлен")


app = FastAPI(title="AI Salesperson Trainer — WS Server", lifespan=lifespan)


@app.get("/health")
async def health():
    """Простой healthcheck."""
    return {"status": "ok"}


@app.post("/cases/generate")
async def generate_case_endpoint(request: Request):
    """Собирает случай пациента под клинику. Зовёт Next.js при сохранении формы.

    Генерация живёт здесь, а не во фронтенде, по двум причинам: тут ключ
    и тут сетевая позиция (из России путь до OpenRouter другой). Но собирать
    промпт из слоёв — работа фронтенда: сборщик написан на TypeScript,
    и второй реализации на Python быть не должно, иначе они разъедутся.
    Поэтому эндпоинт отдаёт слоты, а не готовый текст.

    Проверяем подпись токена, но не роль: роль проверил вызывающий, а сюда
    приходят только те данные, которые он же и прислал. Читать что-либо
    из нашей базы эндпоинт не умеет.
    """
    token = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    if verify_token(token) is None:
        raise HTTPException(status_code=401, detail="Недействительный токен")

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Некорректный запрос") from None

    personality = body.get("personality")
    clinic = body.get("clinic")
    if not isinstance(personality, dict) or not isinstance(clinic, dict):
        raise HTTPException(status_code=400, detail="Нужны personality и clinic")

    # Диагнозы, уже выданные другим пациентам этой клиники. Необязательное:
    # без него сборка работает, просто у пациентов чаще совпадут болезни
    used = body.get("usedDiagnoses")
    used = [str(d) for d in used] if isinstance(used, list) else None

    case = await case_generator.generate_case(personality, clinic, used)
    if case is None:
        # Провайдер не ответил или ответ не прошёл проверку формы. Причина
        # уже в логе; вызывающему важно одно — этот пациент не собрался
        raise HTTPException(status_code=502, detail="Не удалось собрать случай")
    return case


@app.post("/diagnostics/generate")
async def generate_diagnostics_endpoint(request: Request):
    """Генерирует результат диагностики сессии. Зовёт Next.js на старте
    полного разговора — fire-and-forget, пока менеджер проверяет микрофон
    и читает анамнез.

    В отличие от /cases/generate этот эндпоинт читает базу сам: анамнез
    и отрасль уже лежат в ней, гонять их через Node туда-обратно незачем.
    Идемпотентен: готовый результат не перегенерируется (двойной клик
    «Начать», ретрай Node) — иначе повтор мог бы подменить документ,
    который менеджер уже читает.
    """
    token = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    if verify_token(token) is None:
        raise HTTPException(status_code=401, detail="Недействительный токен")

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Некорректный запрос") from None

    session_id = str(body.get("sessionId") or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="Нужен sessionId")

    контекст = await store.get_diagnostics_context(session_id)
    if контекст is None:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if контекст["existing_result"]:
        return {"status": "already"}
    if not контекст["scores_deal"]:
        # Этапная тренировка: сценка диагностики туда не помещается,
        # и кнопки на фронте нет. Генерировать впустую не будем
        return {"status": "skipped"}
    анамнез = (контекст["anamnesis"] or "").strip()
    if not анамнез:
        # Продолжать нечего: без анамнеза генератор ставил бы диагноз
        # с нуля — ровно то, от чего фича защищается своей опорой
        logger.warning(
            "Сессия %s: анамнеза нет, результат диагностики не генерируется",
            session_id,
        )
        return {"status": "no_anamnesis"}

    # Пресетный документ — основной путь. Он написан руками и вычитан врачом,
    # генератор рядом с ним не нужен: показывать всё равно будем пресет,
    # а вызов модели на каждый полный разговор — деньги за текст, который
    # никто не увидит. Копируем в сессию, а не читаем по кнопке: расшифровка
    # показывает то, что видел менеджер, и пересборка случая не должна
    # переписывать задним числом уже состоявшиеся разговоры
    пресет = (контекст["preset_document"] or "").strip()
    if пресет:
        await store.save_diagnostics_result(session_id, пресет)
        logger.info(
            "Сессия %s: результат диагностики — ПРЕСЕТ (%d символов), модель не вызывалась",
            session_id,
            len(пресет),
        )
        return {"status": "preset"}

    ключ, описание = diagnostics.выбрать_исход()
    документ = await diagnostics.generate_result(
        контекст["patient_name"] or "",
        анамнез,
        контекст["industry"] or "",
        описание,
        контекст["description"] or "",
    )
    if документ is None:
        raise HTTPException(status_code=502, detail="Не удалось сгенерировать")

    await store.save_diagnostics_result(session_id, документ)
    logger.info(
        "Сессия %s: результат диагностики — ГЕНЕРАЦИЯ (%s, %d символов)",
        session_id,
        ключ,
        len(документ),
    )
    return {"status": "ok", "outcome": ключ}


async def safe_send(ws: WebSocket, message: dict) -> None:
    """Отправляет сообщение клиенту, не падая при закрытом соединении."""
    try:
        await ws.send_json(message)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось отправить сообщение клиенту: %s", exc)


def _describe(exc: BaseException) -> str:
    """Читаемое описание исключения для лога.

    У части исключений строковое представление пустое — у asyncio.TimeoutError
    в первую очередь. Из-за этого запись обрывалась на двоеточии, и разбирать
    сбой приходилось по соседним строкам вместо самой записи об ошибке.
    """
    text = str(exc).strip()
    name = type(exc).__name__
    return f"{name}: {text}" if text else name


def _user_message(exc: BaseException) -> str:
    """Что показать менеджеру на экране, когда ход сорвался.

    Менеджеру нужно знать, что делать дальше, а не как называется исключение.
    Известные сбои поэтому объясняются словами, а для остальных остаётся тип:
    пустая надпись «Ошибка обработки:» не говорит ни ему, ни нам ничего.
    """
    if isinstance(exc, asyncio.TimeoutError):
        return "Пациент не ответил вовремя — повторите реплику"
    return f"Ошибка обработки: {_describe(exc)}"


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

    def __init__(
        self,
        ws: WebSocket,
        session_id: str,
        tts_stream: "tts.TtsWsStream",
        system_prompt: str,
        scores_deal: bool = True,
    ) -> None:
        self.ws = ws
        self.session_id = session_id
        self.tts_stream = tts_stream
        # Роль пациента вместе с инструкцией этапа: загружается один раз
        # при подключении и не меняется в течение разговора
        self.system_prompt = system_prompt
        # Идёт ли в этом разговоре сделка. У этапной тренировки — нет, и тогда
        # весь механизм доверия выключается целиком: фоновый оценщик не
        # запускается, строка про доверие в промпт не добавляется. Считать
        # порог там нечего — предлагать оплату менеджер и не собирается,
        # а лишние вызовы модели стоят денег и добавляют задержку
        self.scores_deal = scores_deal
        # Документ диагностики после показа менеджером. До кнопки — None:
        # пациент «ещё не сходил», и знать итог ему неоткуда. Живёт в памяти
        # менеджера хода, а не в Redis: показ приходит по этому же сокету,
        # и терять его при обрыве соединения не страшно — при переподключении
        # клиент покажет карточку из своего состояния, а промпт добёрет
        # документ из Postgres в ветке "diagnostics"
        self.diagnostics_text: Optional[str] = None
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
        # Пересеклась ли текущая (ещё не зафиксированная) реплика с речью ИИ:
        # поддакивание на хвосте речи ИИ коммитится уже после того, как ИИ
        # замолчал, и без этого флага проскакивало бы в диалог как реплика
        self._utterance_overlapped_ai = False
        self.playback_end = 0.0  # оценка, когда клиент доиграет буфер (monotonic)
        self._barge_in_until = 0.0  # антидребезг клиентского и STT-триггеров

        # Фоновая оценка этапов: от неё зависит, может ли пациент согласиться
        self._scoring: Optional[asyncio.Task] = None

    # --- Колбэки STT ------------------------------------------------------

    async def on_final(self, text: str) -> None:
        """Обрабатывает зафиксированную реплику менеджера (не блокируя STT)."""
        # Наложилась ли эта реплика на речь ИИ хоть в какой-то момент (partial
        # приходил, пока ИИ говорил). Считываем и сбрасываем на каждой границе
        # коммита — включая фантомы ниже, — чтобы флаг не «протёк» на следующую
        # реплику (on_partial при молчащем ИИ выходит, не сбрасывая его).
        overlapped = self._utterance_overlapped_ai
        self._utterance_overlapped_ai = False
        if self._is_phantom(text):
            return
        # Поддакивание, наложенное на речь ИИ (в т.ч. на самом хвосте, когда
        # коммит приходит уже после того, как ИИ замолчал), — не реплика: не
        # перебиваем (см. on_partial) и не порождаем ответ. Одиночное «да»,
        # сказанное при молчащем ИИ без наложения, — ответ на вопрос: сохраняем.
        if _is_backchannel_only(text) and (self._ai_speaking() or overlapped):
            logger.info(
                "Сессия %s: отброшено поддакивание (наложение на речь ИИ): %s",
                self.session_id,
                text,
            )
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
        """Устойчивый громкий голос во время речи ИИ.

        Больше не перебивает сам по себе: по громкости не отличить
        поддакивание от осмысленной речи. Решение принимает on_partial
        по распознанным словам.
        """
        return

    async def on_partial(self, text: str) -> None:
        """Barge-in по распознанным словам — единственный триггер перебивания.

        Громкость (RMS) сама по себе больше не перебивает: «угу»/«ага» по
        энергии неотличимы от осмысленной речи. Перебиваем только когда
        распознано осмысленное (не-поддакивающее) слово, которого нет
        в звучащем ответе ИИ. Поддакивания смысла не дают — ИИ говорит дальше.
        """
        if not self.barge_in_enabled or not self._ai_speaking():
            return
        # Реплика наложилась на речь ИИ — пометим для turn-фильтра в on_final
        # (поддакивание на хвосте речи не должно попасть в диалог как реплика)
        self._utterance_overlapped_ai = True
        # Scribe галлюцинирует связный текст на тишине (пик RMS единицы),
        # а гейт голоса фильтрует только committed-транскрипты. Partial без
        # недавнего реального голоса во входящем аудио — не перебивание.
        if self.stt is None or self.stt.seconds_since_voice > _PARTIAL_VOICE_MAX_AGE_SECS:
            return
        # Осмысленные слова минус эхо собственного ответа ИИ
        fresh = [w for w in _meaningful_words(text) if w not in self.reply_words]
        # Порог в 2 слова гасит единичный шумно-распознанный звук; явная
        # команда («стоп», «извините») перебивает и одним словом.
        has_command = any(w in _INTERRUPT_COMMANDS for w in fresh)
        if len(fresh) < _BARGE_IN_MIN_MEANINGFUL_WORDS and not has_command:
            return  # только поддакивания/эхо/единичный шум — не перебивание
        await self._maybe_barge_in("partial")

    async def on_client_interrupt(self) -> None:
        """Устаревший путь: клиент больше не шлёт interrupt по громкости.

        Перебивание теперь целиком на стороне сервера (on_partial по словам),
        а клиент глушит звук только по подтверждённому barge_in. Обработчик
        оставлен безопасным no-op на случай старого клиента: реагировать на
        громкость без содержания нельзя — это и есть исходный баг.
        """
        return

    async def on_stt_failed(self) -> None:
        """STT умер и не восстановился — предупреждаем менеджера.

        Иначе он продолжит говорить в пустоту: сессия и TTS живы,
        но распознавание речи больше не работает.
        """
        logger.error(
            "Сессия %s: распознавание речи остановлено окончательно",
            self.session_id,
        )
        await safe_send(
            self.ws,
            {
                "type": "error",
                "message": "Распознавание речи прервано — перезапустите разговор",
            },
        )

    def _ai_speaking(self) -> bool:
        """Ответ ИИ генерируется или предположительно ещё звучит у клиента."""
        if (
            self.task is not None
            and not self.task.done()
            and self.audio_started
        ):
            return True
        return time.monotonic() < self.playback_end

    async def _maybe_barge_in(self, reason: str) -> bool:
        """Обрывает речь ИИ, если менеджер перебивает."""
        if not self.barge_in_enabled or not self._ai_speaking():
            return False
        now = time.monotonic()
        if now < self._barge_in_until:
            return False
        self._barge_in_until = now + 1.0

        if self.task is not None and not self.task.done() and self.audio_started:
            # Перебивание во время генерации: обрываем пайплайн, в историю
            # идёт только та часть ответа, которая успела прозвучать
            spoken = " ".join(self.sent_sentences)
            user_text = self.current_text
            await self._cancel_active()
            await safe_send(self.ws, {"type": "barge_in"})
            self.playback_end = 0.0
            logger.info(
                "Сессия %s: barge-in (%s), ответ оборван (озвучено предложений: %d)",
                self.session_id,
                reason,
                len(self.sent_sentences),
            )
            await store.append_message_cache(self.session_id, "user", user_text)
            self.last_user_text = user_text
            if spoken:
                await safe_send(self.ws, {"type": "transcript_ai", "text": spoken})
                await store.append_message_cache(
                    self.session_id, "assistant", spoken
                )
            asyncio.create_task(
                self._persist_turn(user_text, spoken if spoken else None)
            )
            return True
        elif time.monotonic() < self.playback_end:
            # Пайплайн завершён, но клиент ещё доигрывает буфер — сбрасываем
            # только воспроизведение (история уже записана целиком)
            await safe_send(self.ws, {"type": "barge_in"})
            self.playback_end = 0.0
            logger.info(
                "Сессия %s: barge-in (%s) на доигрывании буфера",
                self.session_id,
                reason,
            )
            return True
        return False

    async def _persist_turn(self, user_text: str, reply: str | None) -> None:
        """Пишет ход в PostgreSQL строго последовательно (user → assistant).

        Параллельные вставки давали одинаковый createdAt, и в расшифровке
        (ORDER BY createdAt) ответ ИИ мог оказаться раньше реплики менеджера.
        """
        await store.persist_message(self.session_id, "user", user_text)
        if reply:
            await store.persist_message(self.session_id, "assistant", reply)

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

    def _with_diagnostics(self, prompt: str) -> str:
        """Доклеивает документ диагностики, если менеджер его уже показал.

        Блок идёт после строки доверия: оба — динамическое знание пациента,
        и порядок их появления в разговоре обычно такой же.
        """
        if not self.diagnostics_text:
            return prompt
        return f"{prompt}\n\n{llm.diagnostics_instruction(self.diagnostics_text)}"

    async def _prompt_with_trust(self, turns: int) -> str:
        """Промпт хода: постоянная часть плюс строка про доверие.

        Строку выбирает код, сравнив последнюю фоновую оценку с порогом.
        Модель числа не видит — только готовую инструкцию.

        Три разных «оценки нет» трактуются по-разному:
          • ходов мало, оценщик ещё не успел — порог не взят. Это правда,
            а не костыль: за пару реплик доверие не строится;
          • ходов много, а оценки так и нет — оценщик сломан, порог
            не применяем. Иначе его молчаливый отказ сделал бы сделку
            незакрываемой, а это ровно тот баг, который мы чиним;
          • оценка была раньше — берём последнюю известную.

        В этапной тренировке строки нет вовсе: сделки там не будет, решать
        роли нечего, а лишний абзац про «нельзя соглашаться оплатить» только
        сбивал бы её с упражнения.
        """
        if not self.scores_deal:
            return self.system_prompt

        settings = get_settings()
        scores = await store.get_stage_scores(self.session_id)

        if scores is None:
            if turns >= _SCORER_BROKEN_AFTER_TURNS:
                logger.warning(
                    "Сессия %s: оценок нет после %d ходов — порог не применяется",
                    self.session_id,
                    turns,
                )
                return self._with_diagnostics(self.system_prompt)
            return self._with_diagnostics(
                f"{self.system_prompt}\n\n{llm.trust_instruction(False)}"
            )

        average = scores.get("average", 0.0)
        reached = average >= settings.deal_score_threshold
        return self._with_diagnostics(
            f"{self.system_prompt}\n\n{llm.trust_instruction(reached)}"
        )

    def schedule_scoring(self) -> None:
        """Пересчитывает оценку этапов в фоне, не задерживая разговор.

        После каждого хода: решающая работа обычно делается в двух-трёх
        репликах прямо перед закрытием, и при редком пересчёте мы отказывали
        бы, не увидев именно её.
        """
        if not self.scores_deal:
            return  # этапная тренировка: порога нет, считать нечего
        if self._scoring is not None and not self._scoring.done():
            return  # предыдущий пересчёт ещё идёт — обгонять его незачем
        self._scoring = asyncio.create_task(self._score_now())

    async def _score_now(self) -> None:
        try:
            history = await store.get_messages(self.session_id)
            # Роль передаём оценщику как контекст: без неё он не сможет
            # судить, докопался ли менеджер до настоящей боли пациента.
            # Рубрика при этом остаётся общей — от неё зависит
            # сопоставимость оценок между разными пациентами
            scores = await scoring.score_stages(history, self.system_prompt)
            if scores is None:
                return

            previous = await store.get_stage_scores(self.session_id)
            payload = scores.as_dict()
            payload["average"] = scores.average
            await store.set_stage_scores(self.session_id, payload)

            threshold = get_settings().deal_score_threshold
            reached = scores.average >= threshold
            was_reached = (
                previous is not None
                and previous.get("average", 0.0) >= threshold
            )
            logger.info(
                "ОЦЕНКА сессия %s: ход %d | контакт %.1f лёд %.1f потребность %.1f "
                "возражения %.1f | средняя %.2f | порог %s%s",
                self.session_id,
                len(history),
                scores.contact,
                scores.iceBreaker,
                scores.needs,
                scores.objections,
                scores.average,
                "ВЗЯТ" if reached else "НЕ взят",
                " ← переход" if reached != was_reached and previous is not None else "",
            )
        except Exception as exc:  # noqa: BLE001
            # Оценка не имеет права ронять разговор
            logger.warning("Фоновая оценка не удалась: %s", exc)

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

            # Промпт на этот ход: постоянная часть плюс строка про доверие.
            # Она зависит от последней фоновой оценки и решает, может ли
            # пациент вообще согласиться на оплату (см. DEAL-OUTCOME.md)
            turn_prompt = await self._prompt_with_trust(len(history))

            # Очередь предложений между LLM (producer) и TTS (consumer);
            # None — маркер конца стрима
            sentences: asyncio.Queue[str | None] = asyncio.Queue()

            # Разбивка задержки по стадиям. Одна цифра «до первого аудио»
            # не отвечает на вопрос «где потеряли»: LLM думает, LLM дописывает
            # первое предложение или TTS его синтезирует — это три разные
            # починки, и без разбивки любая диагностика гадание
            t_prompt_ms = (time.perf_counter() - t_start) * 1000
            first_token_ms: float | None = None
            first_sentence_ms: float | None = None

            async def produce_sentences() -> str:
                """Читает LLM-стрим, кладёт предложения в очередь, возвращает весь ответ."""
                nonlocal first_token_ms, first_sentence_ms
                buffer = ""
                full_reply = ""
                try:
                    async for delta in llm.stream_reply(history, turn_prompt):
                        if first_token_ms is None:
                            first_token_ms = (time.perf_counter() - t_start) * 1000
                        buffer += delta
                        full_reply += delta
                        # Вырезаем из буфера готовые предложения
                        while True:
                            sentence, rest = split_first_sentence(buffer)
                            if sentence is None:
                                break
                            buffer = rest
                            # Ремарка целым предложением после чистки исчезает
                            # вовсе — синтезировать нечего, ждём следующего
                            sentence = strip_for_speech(sentence)
                            if not sentence:
                                continue
                            if first_sentence_ms is None:
                                first_sentence_ms = (
                                    time.perf_counter() - t_start
                                ) * 1000
                            await sentences.put(sentence)
                    # Остаток без завершающей пунктуации тоже озвучиваем
                    tail = strip_for_speech(buffer)
                    if tail:
                        if first_sentence_ms is None:
                            first_sentence_ms = (time.perf_counter() - t_start) * 1000
                        await sentences.put(tail)
                finally:
                    await sentences.put(None)
                # Расшифровка должна совпадать с тем, что прозвучало: ремарки
                # в ней — мусор и для менеджера, и для оценщика
                return strip_for_speech(full_reply)

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
                    # Голос тот же, что у сокета: иначе на сбое пациент
                    # посреди разговора сменил бы пол
                    async for chunk in tts.synthesize_stream(
                        sentence, self.tts_stream.voice_id
                    ):
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
            # Успешное завершение хода — фиксируем историю: кэш синхронно
            # (дёшево, Redis локальный), Postgres фоном одной задачей,
            # чтобы createdAt сохранял порядок user → assistant
            await store.append_message_cache(session_id, "user", text)
            await store.append_message_cache(session_id, "assistant", reply)
            asyncio.create_task(self._persist_turn(text, reply))
            self.last_user_text = text
            # Пересчёт оценки — в фоне: следующий ход её уже увидит, а этот
            # ничего не ждёт
            self.schedule_scoring()

            total_ms = (time.perf_counter() - t_start) * 1000
            logger.info(
                "ТАЙМИНГ сессия %s: промпт=%.0f токен=%s предложение=%s "
                "аудио=%.0f | всего(после STT)=%.0f мс",
                session_id,
                t_prompt_ms,
                "—" if first_token_ms is None else f"{first_token_ms:.0f}",
                "—" if first_sentence_ms is None else f"{first_sentence_ms:.0f}",
                first_audio_ms or 0,
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
            logger.error(
                "Ошибка пайплайна (сессия %s): %s", session_id, _describe(exc)
            )
            await safe_send(
                ws,
                {"type": "error", "message": _user_message(exc)},
            )
        finally:
            if producer is not None and not producer.done():
                producer.cancel()


async def close_if_abandoned(session_id: str) -> Optional[int]:
    """Закрывает разговор, оборвавшийся без «стоп». Возвращает его длительность.

    Закрытая вкладка, упавший браузер, пропавшая сеть — завершение не
    проставит никто: роут `/stop` зовёт только кнопка «Завершить». Сессия
    осталась бы `active` навсегда, а её минуты не попали бы ни в статистику
    менеджера, ни в счётчик часов клиента, хотя оплачены.

    При штатном завершении статус уже `completed`, и функция ничего не делает:
    длительность остаётся от роута `/stop`, там она уже посчитана.

    Никогда не бросает: вызывается из блока завершения сессии, и сбой
    хранилища не имеет права помешать закрыть соединение.
    """
    try:
        seconds = await store.finish_if_unfinished(session_id)
        if seconds is None:
            return None
        logger.info(
            "Сессия %s: закрыта по обрыву связи, длительность %s сек",
            session_id,
            seconds,
        )
        # clear_session зовётся только в ветке «стоп», поэтому у оборванного
        # разговора четыре ключа Redis оставались висеть навсегда
        await store.clear_session(session_id)
        return seconds
    except Exception as exc:  # noqa: BLE001
        logger.warning("Сессия %s: не удалось закрыть: %s", session_id, exc)
        return None


async def award_achievements(session_id: str) -> None:
    """Выдаёт бейджи, заработанные этим разговором.

    Никогда не бросает: игровой бейдж не имеет права мешать ни разбору,
    ни закрытию разговора. Тот же приём, что у `close_if_abandoned`.
    """
    try:
        выданы = await achievements.начислить_за_сессию(store.pool, session_id)
        if выданы:
            logger.info(
                "Сессия %s: выданы достижения — %s", session_id, ", ".join(выданы)
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Сессия %s: достижения не начислены: %s", session_id, exc)


async def после_разговора(session_id: str) -> None:
    """Разбор и достижения — одной фоновой задачей, в этом порядке.

    Порядок обязателен: достижения смотрят на исход сделки из разбора
    и на статус `completed`, который проставляется при закрытии. Запусти
    их раньше — и разговор, где сделка закрыта, не даст «Закрывателя»,
    потому что разбора ещё нет.
    """
    await finalize_review(session_id)
    await award_achievements(session_id)


async def finalize_review(session_id: str) -> None:
    """Разбор разговора после его завершения.

    Определяет исход, ставит пять оценок и пишет выводы. Никогда не бросает:
    вызывается из блока завершения сессии, и её падение не должно мешать
    разговору закрыться.
    """
    try:
        history = await store.get_transcript(session_id)
        if len(history) < 2:
            return  # разговора фактически не было — разбирать нечего

        context = await store.get_review_context(session_id)
        if not context:
            logger.warning(
                "Сессия %s: нет промпта пациента — разбор невозможен", session_id
            )
            return

        review = await scoring.review_conversation(
            history,
            context["patient_prompt"],
            rubric=context["rubric"],
            done_when=context["done_when"],
            scores_deal=context["scores_deal"],
            stage_key=context["stage_key"],
        )
        if review is None:
            logger.warning("Сессия %s: оценщик не вернул разбор", session_id)
            return

        await store.save_review(
            session_id,
            {
                "overall": review.overall,
                "contact": review.stages.contact,
                "iceBreaker": review.stages.iceBreaker,
                "needs": review.stages.needs,
                "objections": review.stages.objections,
                "closing": review.closing,
                "outcome": review.outcome,
                "strength": review.strength,
                "growthPoint": review.growth_point,
                "judgeNotes": review.judge_notes,
                "drillPassed": review.drill_passed,
            },
        )
        if context["scores_deal"]:
            logger.info(
                "ИТОГ сессия %s: исход=%s | оценки: контакт %s лёд %s "
                "потребность %s возражения %s закрытие %s | общая %.1f | %s",
                session_id,
                review.outcome,
                review.stages.contact,
                review.stages.iceBreaker,
                review.stages.needs,
                review.stages.objections,
                review.closing,
                review.overall,
                review.judge_notes or "без пояснений",
            )
        else:
            logger.info(
                "ИТОГ сессия %s: тренировка «%s» — этап %s | оценка %.1f | %s",
                session_id,
                context["type_title"] or "без названия",
                "ОТРАБОТАН" if review.drill_passed else "не отработан",
                review.overall,
                review.judge_notes or "без пояснений",
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Разбор сессии %s не удался: %s", session_id, exc)


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

    # Роль, которую играет ИИ. Без промпта разговор не начинаем: молча играть
    # непонятно кого хуже, чем честно сказать, что персонаж не настроен.
    system_prompt = await store.get_system_prompt(session_id)
    if not system_prompt:
        await safe_send(
            ws,
            {
                "type": "error",
                "message": "Для этого пациента ещё не настроен промпт",
            },
        )
        await ws.close(code=1008)
        return

    logger.info(
        "Сессия %s: подключение установлено (user=%s)", session_id, user_id
    )

    # Постоянный TTS WebSocket на всю сессию: соединение устанавливается
    # здесь один раз, чтобы на каждой реплике не тратить время на TLS.
    #
    # Голос берём до подключения: он вшит в адрес сокета, и сменить его
    # у поднятого соединения нельзя. Пусто — общий из настроек
    voice_id = await store.get_patient_voice(session_id)
    tts_stream = tts.TtsWsStream(voice_id)
    logger.info(
        "Сессия %s: голос %s", session_id, voice_id or "общий из настроек"
    )
    try:
        await tts_stream.start()
    except Exception as exc:  # noqa: BLE001
        # Не критично: stream_sentence переподключится, а при повторном
        # сбое сработает HTTP-фолбэк в консьюмере
        logger.warning("TTS: не удалось открыть WebSocket заранее: %s", exc)

    # 3. Менеджер ходов: получает STT-коммиты, фильтрует фантомы, запускает
    # отменяемый пайплайн LLM -> TTS (склейка разрезанных фраз, barge-in).
    manager = TurnManager(
        ws=ws,
        session_id=session_id,
        tts_stream=tts_stream,
        system_prompt=system_prompt,
        scores_deal=await store.get_scores_deal(session_id),
    )

    # 4. Инициализируем STT (ElevenLabs Realtime)
    api_key = get_settings().elevenlabs_api_key
    stt = ElevenLabsSTT(
        api_key=api_key,
        on_final=manager.on_final,
        on_voice_resumed=manager.on_voice_resumed,
        on_sustained_voice=manager.on_sustained_voice,
        on_partial=manager.on_partial,
        on_fatal=manager.on_stt_failed,
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

            elif msg_type == "interrupt":
                # Клиент локально обнаружил речь поверх воспроизведения
                await manager.on_client_interrupt()

            elif msg_type == "client_audio":
                # Состояние плеера в браузере. Пишем в общий лог, чтобы
                # застревание воспроизведения было видно рядом с таймингами
                # хода: без этого клиентский сбой неотличим от серверного.
                # Диагностика не имеет права ронять разговор: любая ошибка
                # здесь — это потерянная строка лога, а не оборванная сессия
                try:
                    detail = message.get("detail")
                    logger.info(
                        "ПЛЕЕР сессия %s: %s%s поз=%s пауза=%s ready=%s "
                        "буфер=%s диапазонов=%s очередь=%s",
                        session_id,
                        message.get("event"),
                        f" ({detail})" if detail else "",
                        message.get("currentTime"),
                        message.get("paused"),
                        message.get("readyState"),
                        message.get("bufferedEnd"),
                        message.get("ranges"),
                        message.get("queued"),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Не удалось записать состояние плеера: %s", exc)

            elif msg_type == "pause":
                await store.set_status(session_id, STATUS_PAUSED)
                logger.info("Сессия %s: пауза", session_id)

            elif msg_type == "resume":
                await store.set_status(session_id, STATUS_ACTIVE)
                logger.info("Сессия %s: возобновлена", session_id)

            elif msg_type == "diagnostics":
                # Менеджер отыграл сценку голосом и нажал кнопку. Документ
                # сгенерирован на старте сессии и обычно уже ждёт; не готов —
                # клиент получает pending и повторяет запрос сам
                документ = await store.get_diagnostics_result(session_id)

                # Пресет вытягиваем прямо здесь, если на старте до него
                # не дошло. Fire-and-forget из sessions/start отваливался
                # уже дважды — оба раза из-за маршрутов Caddy, и оба раза
                # это выглядело как вечное «Готовим…» без единой ошибки.
                # Для пресетного случая ждать нечего: текст лежит в базе
                if документ is None:
                    контекст = await store.get_diagnostics_context(session_id)
                    пресет = ""
                    if контекст is not None:
                        пресет = (контекст["preset_document"] or "").strip()
                    if пресет:
                        await store.save_diagnostics_result(session_id, пресет)
                        документ = await store.get_diagnostics_result(session_id)
                        logger.info(
                            "Сессия %s: пресет подхвачен по кнопке — "
                            "на старте генерация до него не дошла",
                            session_id,
                        )

                if документ is None:
                    logger.info(
                        "Сессия %s: результат диагностики ещё не готов",
                        session_id,
                    )
                    await safe_send(ws, {"type": "diagnostics_pending"})
                else:
                    manager.diagnostics_text = документ
                    await store.mark_diagnostics_shown(session_id)
                    await safe_send(
                        ws, {"type": "diagnostics_result", "text": документ}
                    )
                    logger.info(
                        "Сессия %s: результат диагностики показан менеджеру",
                        session_id,
                    )

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

        # Закрытие оборванного разговора стоит ПОСЛЕ остановки пайплайна,
        # а не перед ней: отменяемый ход дописывает историю в Redis
        # (append_message_cache), и очистка до shutdown воскресила бы ключи,
        # которые только что удалили.
        await close_if_abandoned(session_id)

        # Разбор и достижения. Фоновой задачей и с перехватом всего: оценка
        # не имеет права влиять на завершение сессии — при её сбое разговор
        # должен закрыться штатно, а расшифровка сохраниться.
        #
        # Стоит ПОСЛЕ закрытия, а не перед ним: достижения считают только
        # завершённые разговоры, и запущенные раньше они не увидели бы
        # ни статуса, ни самого этого разговора
        asyncio.create_task(после_разговора(session_id))

        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
        logger.info("Сессия %s: соединение закрыто", session_id)
