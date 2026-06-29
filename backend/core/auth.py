"""Проверка JWT-токена.

Токен выпускается Next.js приложением (библиотека jose, алгоритм HS256)
и содержит поля: sub (id пользователя), email, name, iat, exp.
Здесь мы проверяем подпись тем же секретом JWT_SECRET.
"""

import logging
from typing import Optional, TypedDict

import jwt

from core.config import get_settings

logger = logging.getLogger(__name__)


class TokenPayload(TypedDict):
    """Полезная нагрузка токена."""

    sub: str
    email: str
    name: str


def verify_token(token: Optional[str]) -> Optional[TokenPayload]:
    """Проверяет подпись и срок действия токена.

    Возвращает полезную нагрузку или None, если токен отсутствует/невалиден.
    """
    if not token:
        return None

    settings = get_settings()
    if not settings.jwt_secret:
        logger.error("JWT_SECRET не задан — невозможно проверить токен")
        return None

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
        )
        # Минимальная валидация структуры
        if "sub" not in payload:
            return None
        return payload  # type: ignore[return-value]
    except jwt.ExpiredSignatureError:
        logger.info("Токен просрочен")
        return None
    except jwt.InvalidTokenError as exc:
        logger.info("Невалидный токен: %s", exc)
        return None
