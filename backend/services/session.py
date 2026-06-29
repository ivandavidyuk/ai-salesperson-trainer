"""Управление состоянием сессии.

Состояние живёт в Redis:
    session:{id}:status    -> "active" | "paused" | "completed"
    session:{id}:messages  -> JSON-список сообщений (контекст для LLM)

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

    async def append_message(
        self, session_id: str, role: str, text: str
    ) -> None:
        """Добавляет сообщение в историю Redis и сохраняет его в PostgreSQL.

        role: "user" (менеджер) | "assistant" (клиент-ИИ).
        """
        assert self._redis is not None and self._pool is not None

        # 1. Контекст для LLM — в Redis
        await self._redis.rpush(
            _messages_key(session_id),
            json.dumps({"role": role, "text": text}, ensure_ascii=False),
        )

        # 2. Постоянное хранение — в PostgreSQL.
        # id в таблице не имеет дефолта в БД (Prisma генерирует его на уровне
        # клиента), поэтому формируем UUID сами.
        await self._pool.execute(
            'INSERT INTO "Message" ("id", "sessionId", "role", "text", "createdAt") '
            'VALUES ($1, $2, $3::"MessageRole", $4, NOW())',
            str(uuid.uuid4()),
            session_id,
            role,
            text,
        )

    # --- Очистка ---------------------------------------------------------

    async def clear_session(self, session_id: str) -> None:
        """Удаляет онлайн-данные сессии из Redis (история в БД сохраняется)."""
        assert self._redis is not None
        await self._redis.delete(
            _status_key(session_id), _messages_key(session_id)
        )
