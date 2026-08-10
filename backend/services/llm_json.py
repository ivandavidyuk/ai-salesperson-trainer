"""Запрос к модели, отвечающей JSON: повторы, разбор, честный лог.

Вынесено из scoring.py, когда появился третий потребитель — генератор случая.
Модель приходит параметром, а не выбирается флагом: раньше их было две
(фоновый и итоговый оценщик), и флага хватало, но с третьей это перестало
работать.

Ни одна функция здесь не бросает: и оценка, и генерация — вспомогательные
задачи, и их сбой не должен ронять то, ради чего они запущены.
"""

import asyncio
import json
import logging
from typing import Optional

import httpx

from core.config import get_settings
from services import usage
from services.llm import reasoning_for

logger = logging.getLogger(__name__)

# Общий клиент на модуль: переиспользует TCP/TLS между запросами
_client = httpx.AsyncClient(timeout=180)

# Провайдер отвечает HTTP 200, но кладёт внутрь finish_reason=error —
# обычно это 429 «temporarily rate-limited upstream» от Google
_RETRY_DELAY_SEC = 2.0


def unfence(content: str) -> str:
    """Снимает markdown-заборчик вокруг JSON.

    Часть моделей оборачивает ответ в ```json … ``` даже при явном
    response_format=json_object — так делает, например, claude-haiku-4.5.
    Ответ при этом полностью корректный, спотыкается только наш разбор,
    и модель выглядит непригодной, хотя дело в одной строке кода.
    """
    text = content.strip()
    if not text.startswith("```"):
        return text
    # Первая строка — открывающий забор с необязательным языком
    without_open = text.split("\n", 1)[-1]
    return without_open.rsplit("```", 1)[0].strip()


async def ask_json(
    messages: list[dict],
    *,
    model: str,
    purpose: str,
    attempts: int = 1,
    temperature: float = 0.2,
    max_tokens: int = 8000,
    reasoning: Optional[str] = "medium",
) -> Optional[dict]:
    """Спрашивает модель и возвращает разобранный JSON либо None.

    @param attempts сколько раз повторить при отказе провайдера. Единица
    уместна там, где следующая попытка случится сама (фоновый оценщик
    пересчитается на следующем ходу); больше — там, где второго шанса нет.

    @param reasoning уровень усилия: medium по умолчанию, None — не думать.
    Роль сюда не ходит: у неё размышление своё, ради первого токена.

    ПОЧЕМУ ИМЕННО effort, А НЕ enabled. До 06.08 здесь стояло
    `{"enabled": True}`, и это НЕ РАБОТАЛО: замер на gemini-3.5-flash-lite
    показал ноль токенов размышления при каждой форме, кроме effort.

        без параметра   0        effort=minimal  0
        enabled=true    0        effort=low      0
        effort=medium 818        effort=high   834      effort=max 841

    Выше medium модель думать не начинает — сколько тратить, Google решает
    внутри. У gpt-4o-mini размышления нет ни на одном уровне, и параметр
    он просто игнорирует, не ломаясь.

    То же знание уже лежало в llm.py для роли (там `effort: minimal`
    и запись, что `enabled: false` даёт HTTP 400 «Reasoning is mandatory»),
    но сюда не доехало — и полгода все вызовы шли без размышления,
    хотя код утверждал обратное.
    """
    settings = get_settings()
    if not settings.llm_api_key:
        logger.warning("%s: нет ключа LLM", purpose)
        return None

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        # Уровень усилия задан явно — берём как есть. Не задан — берём ручку
        # под конкретную модель из llm.reasoning_for: она снята замером
        # 31.07 и у каждого семейства своя. Прежний жёсткий minimal был
        # выключением только на словах: 10.08 читатель на haiku выдал
        # 1519 токенов размышления, а они тарифицируются как выход по $5/М
        # и составляли большую часть счёта прогона
        "reasoning": {"effort": reasoning} if reasoning else reasoning_for(model),
        "max_tokens": max_tokens,
    }

    for attempt in range(1, attempts + 1):
        result = await _attempt(payload, purpose=purpose, attempt=attempt)
        if result is not None:
            return result
        if attempt < attempts:
            # Пауза растёт: при троттлинге сверху немедленный повтор
            # упирается в тот же лимит
            await asyncio.sleep(_RETRY_DELAY_SEC * attempt)

    if attempts > 1:
        logger.warning("%s: %d попытки подряд без ответа", purpose, attempts)
    return None


async def _attempt(payload: dict, *, purpose: str, attempt: int) -> Optional[dict]:
    """Одна попытка. Возвращает разобранный JSON либо None с записью в лог."""
    settings = get_settings()
    try:
        response = await _client.post(
            f"{settings.llm_base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
        )
        response.raise_for_status()
        тело = response.json()
        # Учёт токенов: провайдер присылает usage в каждом ответе, и это
        # единственный способ узнать расход точно. В бою учёт не открыт,
        # и вызов ничего не делает
        usage.записать(payload.get("model", "?"), тело.get("usage"))
        choice = (тело.get("choices") or [{}])[0]
    except Exception as exc:  # noqa: BLE001
        logger.warning("%s, попытка %d: запрос не прошёл: %s", purpose, attempt, exc)
        return None

    content = (choice.get("message") or {}).get("content")
    if not content:
        # Пустой content при HTTP 200 — это отказ провайдера, и разбирать
        # его как JSON бессмысленно: получим загадочную ошибку про NoneType
        logger.warning(
            "%s, попытка %d: пустой ответ (finish=%s, причина=%s)",
            purpose,
            attempt,
            choice.get("finish_reason"),
            str(choice.get("error") or "не указана")[:200],
        )
        return None

    try:
        return json.loads(unfence(content))
    except json.JSONDecodeError as exc:
        logger.warning(
            "%s, попытка %d: ответ не разобрался (%s), начало: %.120s",
            purpose,
            attempt,
            exc,
            content,
        )
        return None
