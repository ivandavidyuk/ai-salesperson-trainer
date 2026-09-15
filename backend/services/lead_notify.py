"""Уведомление о заявке с лендинга в групповой чат «Заявки podhod».

Почему здесь, а не во фронтенде: RU-сервер не достаёт api.telegram.org
по IPv4 (замер 15.09.2026 — таймаут в пяти попытках из пяти), а у контейнера
frontend нет IPv6. С DE тот же запрос отвечает за 0,1 с. Заявку сохраняет
фронтенд в своей базе на RU, сюда приходит только то, что нужно для
сообщения, и здесь оно не хранится.

Бот один и чат один: в группе Иван, Дима и бот. Новых людей добавляют
в группу, а не в код. Токен и номер чата — в backend.env на DE
(TELEGRAM_BOT_TOKEN, TELEGRAM_LEADS_CHAT_ID).
"""

import logging
import re
from typing import Optional, TypedDict

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

TIMEOUT_SEC = 5.0

# Совпадает с TEAM_SIZES и FIELD_MAX в frontend/lib/leads.ts
TEAM_SIZES = ("1–2", "3–5", "6–15", "больше 15")
FIELD_MAX = 100

# Ник Telegram: 5–32 знака из латиницы, цифр и подчёркивания
_USERNAME = re.compile(r"^@?([A-Za-z0-9_]{5,32})$")


class Lead(TypedDict):
    name: str
    telegram: str
    industry: str
    teamSize: str  # noqa: N815 — ключ в JSON от фронтенда


def parse_lead(body: object) -> Optional[Lead]:
    """Заявка из тела запроса или None, если она неполная."""
    if not isinstance(body, dict):
        return None
    fields = {}
    for key in ("name", "telegram", "industry", "teamSize"):
        value = body.get(key)
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > FIELD_MAX:
            return None
        fields[key] = value.strip()
    if fields["teamSize"] not in TEAM_SIZES:
        return None
    return Lead(**fields)  # type: ignore[typeddict-item]


def format_lead(lead: Lead) -> str:
    """Текст уведомления. Ник превращается в ссылку — написать одним нажатием;
    у номера телефона ссылки в Telegram нет, он остаётся как есть."""
    match = _USERNAME.match(lead["telegram"])
    contact = f"@{match.group(1)} — https://t.me/{match.group(1)}" if match else lead["telegram"]
    return "\n".join(
        [
            "Новая заявка с лендинга",
            "",
            f"Имя: {lead['name']}",
            f"Telegram: {contact}",
            f"Сфера: {lead['industry']}",
            f"Менеджеров в отделе: {lead['teamSize']}",
        ]
    )


async def send_lead(lead: Lead) -> bool:
    """Отправляет уведомление. Не бросает: вызывающему важно одно — дошло ли."""
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_leads_chat_id:
        logger.error(
            "Заявка не отправлена в Telegram: не заданы TELEGRAM_BOT_TOKEN "
            "или TELEGRAM_LEADS_CHAT_ID"
        )
        return False

    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SEC) as client:
            response = await client.post(
                url,
                json={
                    "chat_id": settings.telegram_leads_chat_id,
                    "text": format_lead(lead),
                    "disable_web_page_preview": True,
                },
            )
    except httpx.HTTPError as exc:
        # Текст исключения httpx содержит адрес, а в адресе токен — в лог
        # идёт только тип
        logger.error("Telegram не ответил на заявку: %s", type(exc).__name__)
        return False

    if response.status_code != 200:
        logger.error(
            "Telegram не принял заявку: HTTP %s %s",
            response.status_code,
            response.text[:200],
        )
        return False
    return True
