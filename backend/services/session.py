"""Управление состоянием сессии.

Состояние живёт в Redis:
    session:{id}:status    -> "active" | "paused" | "completed"
    session:{id}:messages  -> JSON-список сообщений (контекст для LLM)
    session:{id}:prompt    -> системный промпт (роль пациента + этап)

Кроме того, каждое сообщение диалога сохраняется в PostgreSQL (таблица
"Message"), созданную миграцией Prisma из Next.js приложения.

Сессии изначально создаёт Next.js (запись в таблице "Session" со статусом
active). При первом подключении к WebSocket мы подтягиваем статус из
PostgreSQL в Redis, если его там ещё нет.
"""

import json
import logging
import uuid
from typing import Optional

import asyncpg
import redis.asyncio as aioredis

from core.config import get_settings
from services import llm

logger = logging.getLogger(__name__)

# Допустимые статусы
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_COMPLETED = "completed"


def _ws_token_key(ws_token: str) -> str:
    return f"ws_token:{ws_token}"


def _status_key(session_id: str) -> str:
    return f"session:{session_id}:status"


def _messages_key(session_id: str) -> str:
    return f"session:{session_id}:messages"


def _prompt_key(session_id: str) -> str:
    return f"session:{session_id}:prompt"


# Роль пациента для сессии: сначала случай, собранный под клинику этого
# пользователя, и лишь при его отсутствии — исходный промпт из сида.
#
# COALESCE и есть страховка на выкатку: пока руководитель не заполнил форму,
# PatientCase пуст и разговор идёт ровно как раньше. Тем же порядком читает
# итоговый оценщик — иначе он судил бы по офтальмологии разговор, который
# роль вела про зубы.
_PATIENT_PROMPT_SQL = (
    'SELECT COALESCE(pc."prompt", p."prompt") AS patient_prompt, '
    'p."name" AS patient_name, '
    '(pc."prompt" IS NOT NULL) AS case_generated, '
    't."prompt" AS type_prompt, t."title" AS type_title, '
    # Рубрика, критерий и способ оценки — оценщику, а не роли: знай роль,
    # по каким признакам судят собеседника, она начала бы подыгрывать
    't."rubric" AS type_rubric, t."doneWhen" AS type_done_when, '
    't."stageKey" AS type_stage_key, '
    # У сессий, начатых до мастера настройки, типа нет вовсе — это были
    # полные разговоры, поэтому COALESCE на true
    'COALESCE(t."scoresDeal", true) AS type_scores_deal '
    'FROM "Session" s '
    'LEFT JOIN "Patient" p ON p."id" = s."patientId" '
    'LEFT JOIN "TrainingType" t ON t."id" = s."trainingTypeId" '
    'LEFT JOIN "User" u ON u."id" = s."userId" '
    'LEFT JOIN "PatientCase" pc ON pc."patientId" = s."patientId" '
    '  AND pc."organizationId" = u."organizationId" '
    'WHERE s."id" = $1'
)


def _scores_key(session_id: str) -> str:
    """Последняя фоновая оценка этапов — от неё зависит порог допуска."""
    return f"session:{session_id}:scores"


class SessionStore:
    """Хранилище состояния сессий: Redis (онлайн-состояние) + Postgres (история)."""

    def __init__(self) -> None:
        self._redis: Optional[aioredis.Redis] = None
        self._pool: Optional[asyncpg.Pool] = None

    # --- Инициализация / завершение -------------------------------------

    async def connect(self) -> None:
        """Открывает подключения к Redis и PostgreSQL."""
        settings = get_settings()
        self._redis = aioredis.from_url(
            settings.redis_url, decode_responses=True
        )
        self._pool = await asyncpg.create_pool(
            dsn=settings.asyncpg_dsn, min_size=1, max_size=5
        )
        logger.info("SessionStore: подключения к Redis и PostgreSQL установлены")

    async def close(self) -> None:
        """Закрывает подключения."""
        if self._redis is not None:
            await self._redis.aclose()
        if self._pool is not None:
            await self._pool.close()
        logger.info("SessionStore: подключения закрыты")

    # --- Авторизация WebSocket ------------------------------------------

    async def consume_ws_token(self, ws_token: Optional[str]) -> Optional[str]:
        """Проверяет одноразовый ws-токен и возвращает привязанный userId.

        Токен одноразовый: при успешной проверке он сразу удаляется из Redis.
        Возвращает None, если токен отсутствует, не найден или истёк.
        """
        if not ws_token:
            return None
        assert self._redis is not None
        key = _ws_token_key(ws_token)
        # GETDEL атомарно читает и удаляет ключ (одноразовое использование)
        user_id = await self._redis.getdel(key)
        return user_id

    async def get_session_owner(self, session_id: str) -> Optional[str]:
        """Возвращает userId владельца сессии из PostgreSQL (или None)."""
        assert self._pool is not None
        row = await self._pool.fetchrow(
            'SELECT "userId" FROM "Session" WHERE "id" = $1', session_id
        )
        return None if row is None else str(row["userId"])

    # --- Работа со статусом ---------------------------------------------

    async def load_session(self, session_id: str) -> Optional[str]:
        """Возвращает текущий статус сессии.

        Сначала смотрит в Redis. Если там пусто — обращается к PostgreSQL,
        и при наличии сессии переносит статус в Redis. Возвращает None,
        если сессия вообще не найдена.
        """
        assert self._redis is not None and self._pool is not None

        status = await self._redis.get(_status_key(session_id))
        if status is not None:
            return status

        # В Redis нет — пробуем подтянуть из БД
        row = await self._pool.fetchrow(
            'SELECT "status" FROM "Session" WHERE "id" = $1', session_id
        )
        if row is None:
            return None

        db_status = str(row["status"])
        await self._redis.set(_status_key(session_id), db_status)
        return db_status

    async def get_status(self, session_id: str) -> Optional[str]:
        """Текущий статус сессии из Redis."""
        assert self._redis is not None
        return await self._redis.get(_status_key(session_id))

    async def set_status(self, session_id: str, status: str) -> None:
        """Записывает статус сессии в Redis и синхронизирует с PostgreSQL."""
        assert self._redis is not None and self._pool is not None
        await self._redis.set(_status_key(session_id), status)

        # Поддерживаем статус в БД актуальным; для completed ставим endedAt
        if status == STATUS_COMPLETED:
            await self._pool.execute(
                'UPDATE "Session" SET "status" = $1::"SessionStatus", '
                '"endedAt" = NOW() WHERE "id" = $2',
                status,
                session_id,
            )
        else:
            await self._pool.execute(
                'UPDATE "Session" SET "status" = $1::"SessionStatus" WHERE "id" = $2',
                status,
                session_id,
            )

    # --- Работа с сообщениями -------------------------------------------

    async def get_messages(self, session_id: str) -> list[dict]:
        """Возвращает историю сообщений сессии (для контекста LLM)."""
        assert self._redis is not None
        raw = await self._redis.lrange(_messages_key(session_id), 0, -1)
        return [json.loads(item) for item in raw]

    async def append_message_cache(
        self, session_id: str, role: str, text: str
    ) -> None:
        """Добавляет сообщение в контекст LLM (Redis-кэш).

        role: "user" (менеджер) | "assistant" (клиент-ИИ).
        Redis локален для backend — вызов дешёвый, можно ждать синхронно.
        """
        assert self._redis is not None
        await self._redis.rpush(
            _messages_key(session_id),
            json.dumps({"role": role, "text": text}, ensure_ascii=False),
        )

    async def persist_message(
        self, session_id: str, role: str, text: str
    ) -> None:
        """Сохраняет сообщение в PostgreSQL (первичное хранилище, RU-сервер).

        Вызывается фоновой задачей: межстрановая задержка до Postgres
        не должна блокировать голосовой конвейер.
        """
        assert self._pool is not None
        # id в таблице не имеет дефолта в БД (Prisma генерирует его на уровне
        # клиента), поэтому формируем UUID сами.
        try:
            await self._pool.execute(
                'INSERT INTO "Message" ("id", "sessionId", "role", "text", "createdAt") '
                'VALUES ($1, $2, $3::"MessageRole", $4, NOW())',
                str(uuid.uuid4()),
                session_id,
                role,
                text,
            )
        except Exception as exc:  # noqa: BLE001
            # Фоновая задача: ошибку логируем, конвейер не трогаем
            logger.error(
                "Не удалось сохранить сообщение в PostgreSQL (сессия %s): %s",
                session_id,
                exc,
            )


    # --- Системный промпт ------------------------------------------------

    async def get_system_prompt(self, session_id: str) -> Optional[str]:
        """Собирает системный промпт сессии: роль пациента + этап тренировки.

        Возвращает None, если у пациента нет промпта — играть непонятно кого
        хуже, чем честно отказаться начинать разговор.

        Результат кэшируется в Redis: переподключение к живой сессии не ходит
        в Postgres второй раз.
        """
        assert self._redis is not None and self._pool is not None

        cached = await self._redis.get(_prompt_key(session_id))
        if cached is not None:
            return cached or None

        row = await self._pool.fetchrow(_PATIENT_PROMPT_SQL, session_id)
        if row is None:
            return None

        # Проверяем именно роль пациента, а не итоговую склейку: с одним лишь
        # промптом этапа ИИ играл бы непонятно кого, а строка была бы непустой
        if not (row["patient_prompt"] or "").strip():
            logger.error(
                "Сессия %s: у пациента «%s» не заполнен промпт",
                session_id,
                row["patient_name"] or "не задан",
            )
            return None

        prompt = llm.build_system_prompt(row["patient_prompt"], row["type_prompt"])

        logger.info(
            "Сессия %s: промпт собран — пациент «%s», тип «%s», случай %s, "
            "%d символов",
            session_id,
            row["patient_name"],
            row["type_title"] or "не задан",
            "клиники" if row["case_generated"] else "исходный",
            len(prompt),
        )
        await self._redis.set(_prompt_key(session_id), prompt)
        return prompt

    # --- Итоговый разбор --------------------------------------------------

    async def get_transcript(self, session_id: str) -> list[dict]:
        """Полная расшифровка из Postgres, в порядке разговора.

        Не из Redis: итоговый разбор идёт уже после того, как онлайн-состояние
        сессии очищено, а в базе история сохраняется навсегда.
        """
        assert self._pool is not None
        rows = await self._pool.fetch(
            'SELECT "role"::text AS role, "text" FROM "Message" '
            'WHERE "sessionId" = $1 ORDER BY "createdAt" ASC',
            session_id,
        )
        return [{"role": row["role"], "text": row["text"]} for row in rows]

    async def get_scores_deal(self, session_id: str) -> bool:
        """Идёт ли в этой сессии сделка.

        Нужно в начале разговора, до первого хода: от этого зависит, включать
        ли механизм доверия целиком. Отдельным запросом, а не через
        get_system_prompt: тот кэширует склеенный промпт в Redis, и флагу
        там не место — он про сессию, а не про текст.

        У сессий без типа (начаты до мастера настройки) сделка идёт: это были
        полные разговоры.
        """
        assert self._pool is not None
        row = await self._pool.fetchrow(
            'SELECT COALESCE(t."scoresDeal", true) AS scores_deal '
            'FROM "Session" s '
            'LEFT JOIN "TrainingType" t ON t."id" = s."trainingTypeId" '
            'WHERE s."id" = $1',
            session_id,
        )
        return bool(row["scores_deal"]) if row else True

    async def get_review_context(self, session_id: str) -> Optional[dict]:
        """Всё, что нужно итоговому оценщику: промпт пациента и настройки типа.

        Промпт — тот же текст, что был у роли. Оценщик проверяет условия
        согласия по нему, а не по своему представлению о правильной продаже.
        Поэтому и случай клиники берётся тот же самый: иначе он судил бы по
        офтальмологии разговор, который роль вела про зубы, и не нашёл бы ни
        одного выполненного условия.

        Настройки типа решают, какой это вообще разбор: полный разговор
        с исходом сделки или тренировка одного навыка с вердиктом
        «отработан или нет».
        """
        assert self._pool is not None
        row = await self._pool.fetchrow(_PATIENT_PROMPT_SQL, session_id)
        if row is None:
            return None
        prompt = (row["patient_prompt"] or "").strip()
        if not prompt:
            return None
        return {
            "patient_prompt": prompt,
            "rubric": row["type_rubric"],
            "done_when": row["type_done_when"],
            "stage_key": row["type_stage_key"],
            "scores_deal": bool(row["type_scores_deal"]),
            "type_title": row["type_title"],
        }

    async def save_review(self, session_id: str, review: dict) -> None:
        """Записывает разбор разговора. Существующий перезаписывает.

        Оценки этапов и исход приходят как None у этапной тренировки: там
        измерялся один навык, а остальные этапы разговора не было. NULL и ноль
        здесь означают разное — ноль утянул бы менеджеру недельный «Прогресс»,
        а NULL Prisma в средних не учитывает.
        """
        assert self._pool is not None
        await self._pool.execute(
            'INSERT INTO "SessionReview" ('
            '"id", "sessionId", "overallScore", "contactScore", '
            '"iceBreakerScore", "needsScore", "objectionsScore", '
            '"closingScore", "outcome", "strength", "growthPoint", '
            '"judgeNotes", "drillPassed", "createdAt") '
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"DealOutcome", '
            "$10, $11, $12, $13, NOW()) "
            'ON CONFLICT ("sessionId") DO UPDATE SET '
            '"overallScore" = EXCLUDED."overallScore", '
            '"contactScore" = EXCLUDED."contactScore", '
            '"iceBreakerScore" = EXCLUDED."iceBreakerScore", '
            '"needsScore" = EXCLUDED."needsScore", '
            '"objectionsScore" = EXCLUDED."objectionsScore", '
            '"closingScore" = EXCLUDED."closingScore", '
            '"outcome" = EXCLUDED."outcome", '
            '"strength" = EXCLUDED."strength", '
            '"growthPoint" = EXCLUDED."growthPoint", '
            '"judgeNotes" = EXCLUDED."judgeNotes", '
            '"drillPassed" = EXCLUDED."drillPassed"',
            str(uuid.uuid4()),
            session_id,
            review["overall"],
            review["contact"],
            review["iceBreaker"],
            review["needs"],
            review["objections"],
            review["closing"],
            review["outcome"],
            review["strength"],
            review["growthPoint"],
            review["judgeNotes"],
            review.get("drillPassed"),
        )

    # --- Оценка разговора ------------------------------------------------

    async def set_stage_scores(self, session_id: str, scores: dict) -> None:
        """Сохраняет свежую фоновую оценку этапов."""
        assert self._redis is not None
        await self._redis.set(_scores_key(session_id), json.dumps(scores))

    async def get_stage_scores(self, session_id: str) -> Optional[dict]:
        """Последняя известная оценка. None — фоновый оценщик ещё не отработал."""
        assert self._redis is not None
        raw = await self._redis.get(_scores_key(session_id))
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    # --- Очистка ---------------------------------------------------------

    async def clear_session(self, session_id: str) -> None:
        """Удаляет онлайн-данные сессии из Redis (история в БД сохраняется)."""
        assert self._redis is not None
        await self._redis.delete(
            _status_key(session_id),
            _messages_key(session_id),
            _prompt_key(session_id),
            _scores_key(session_id),
        )
