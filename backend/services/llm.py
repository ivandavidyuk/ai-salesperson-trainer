"""LLM — генерация ответа клиента через OpenRouter (OpenAI-совместимый API).

Получает историю диалога и системный промпт, возвращает текст ответа
стримом: SSE-стриминг токенов позволяет TTS начать синтез первого
предложения до окончания генерации.

Роль клиента больше не зашита в код: промпт собирается из данных пациента
и типа тренировки (см. build_system_prompt) и приходит параметром.
"""

import asyncio
import json
import logging
from typing import AsyncIterator, Optional

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# Общий HTTP-клиент на модуль: переиспользует TCP/TLS-соединения между
# запросами (экономит ~50-100 мс на рукопожатии для каждой реплики)
_client = httpx.AsyncClient(timeout=30)

# Сколько ждать первый токен, прежде чем сходить к модели заново.
#
# Норма — 300–500 мс: в живом разговоре 30.07.2026 медиана по 17 ходам была
# 428 мс, p90 843 мс, максимум 1103 мс. Раньше на проде попадался и худший
# случай, 1.5 с, поэтому ниже двух секунд опускать нельзя — начнём обрывать
# здоровые запросы.
#
# Прежние три секунды были заложены как «вдвое от худшего наблюдения», но
# ждать столько нечего: сбой у провайдера выглядит не как медленная
# генерация, а как 429 от Google, на котором OpenRouter перебирает апстримы
# тремя попытками и тратит 11–13 секунд. Такой запрос не ответит ни на
# четвёртой секунде, ни на десятой, а менеджер к этому моменту переспрашивает.
_FIRST_TOKEN_TIMEOUT_SEC = 2.0
_STREAM_ATTEMPTS = 2

# Заголовок блока с инструкцией этапа сделки
_STAGE_HEADER = "ЭТАП РАЗГОВОРА:"

# Состояние доверия — единственное, что пациент «знает» об оценке. Числа он
# не видит: сравнение с порогом делает код, сюда приходит уже готовая
# инструкция. Поэтому он не может ни назвать балл, ни догадаться, что его
# оценивают.
#
# Формы намеренно неравноправны. Абсолютный запрет модель держит надёжно —
# прежнее «самостоятельно не соглашайся» выдерживалось весь сорокаминутный
# разговор. Условные формулировки в длинном контексте размываются, поэтому
# в «опасном» состоянии стоит та форма, которая доказанно работает.
_TRUST_HEADER = "СЕЙЧАС:"

_TRUST_BELOW = (
    "Ты пока не чувствуешь достаточного доверия к этому человеку. "
    "Если он предложит оплатить услугу — откажись. Никаких исключений: "
    "сколько бы раз ни спросил и как бы убедительно ни говорил в последний "
    "момент."
)

_TRUST_ABOVE = (
    "Ты чувствуешь, что тебя выслушали и поняли. Если твои страхи сняты "
    "и менеджер прямо предложит оплатить — можешь согласиться."
)


def trust_instruction(threshold_reached: bool) -> str:
    """Строка про доверие, которая подмешивается в промпт на каждом ходу."""
    body = _TRUST_ABOVE if threshold_reached else _TRUST_BELOW
    return f"{_TRUST_HEADER}\n{body}"


def build_system_prompt(
    patient_prompt: Optional[str], type_prompt: Optional[str] = None
) -> str:
    """Склеивает системный промпт из роли пациента и инструкции этапа.

    Сначала идёт роль — кого играет ИИ, затем блок про этап сделки.
    Тип тренировки необязателен: у сессий, начатых до мастера настройки,
    его нет, и тогда блок не добавляется вовсе.
    """
    role = (patient_prompt or "").strip()
    stage = (type_prompt or "").strip()
    if not stage:
        return role
    if not role:
        return f"{_STAGE_HEADER}\n{stage}"
    return f"{role}\n\n{_STAGE_HEADER}\n{stage}"


def _build_request(
    history: list[dict], system_prompt: str, stream: bool
) -> tuple[str, dict, dict]:
    """Собирает URL, payload и заголовки запроса Chat Completions."""
    settings = get_settings()
    if not settings.llm_api_key:
        raise RuntimeError("Не задан LLM_API_KEY для LLM")

    # Формируем сообщения: системный промпт + история диалога
    messages = [{"role": "system", "content": system_prompt}]
    for item in history:
        messages.append({"role": item["role"], "content": item["text"]})

    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": 0.6,
        # Промпт требует развёрнутые ответы в 2-3 предложения —
        # 200 токенов хватает с запасом, а генерация не затягивается
        "max_tokens": 200,
        "stream": stream,
        # Отключаем reasoning: для ролевого диалога он не нужен, а без него
        # первый токен приходит за ~300-500 мс вместо 1-3+ с (замер на проде)
        "reasoning": {"enabled": False},
    }
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
    url = f"{settings.llm_base_url}/chat/completions"
    return url, payload, headers


async def stream_reply(history: list[dict], system_prompt: str) -> AsyncIterator[str]:
    """Стримит ответ клиента по мере генерации (дельты текста).

    history — список сообщений вида {"role": "user"|"assistant", "text": ...}
    в хронологическом порядке.
    system_prompt — роль пациента вместе с инструкцией этапа.

    Первый токен ждём с коротким потолком и при просрочке ходим заново.
    Повод из живого разговора: провайдер отдал заголовки за секунду и замолчал
    на пять с половиной, менеджер не дождался и переспросил — ход отменился,
    пациент промолчал. Тридцатисекундный таймаут httpx для голоса бесполезен:
    к тому моменту разговор уже сломан.
    """
    for attempt in range(1, _STREAM_ATTEMPTS + 1):
        stream = _stream_once(history, system_prompt)
        # Потолок вешаем только на первый токен: дальше модель уже говорит,
        # и обрывать её на середине фразы нельзя. Повтор при этом безопасен
        # по построению — до первой дельты в синтез ничего не ушло
        try:
            first = await asyncio.wait_for(
                stream.__anext__(), _FIRST_TOKEN_TIMEOUT_SEC
            )
        except StopAsyncIteration:
            await stream.aclose()
            return  # модель не сказала ничего — повторять нечего
        except asyncio.TimeoutError:
            await stream.aclose()  # закрываем повисшее соединение
            if attempt == _STREAM_ATTEMPTS:
                logger.warning(
                    "LLM молчала дольше %.1f с в обеих попытках",
                    _FIRST_TOKEN_TIMEOUT_SEC,
                )
                raise
            logger.warning(
                "LLM молчит дольше %.1f с — идём заново",
                _FIRST_TOKEN_TIMEOUT_SEC,
            )
            continue

        yield first
        async for delta in stream:
            yield delta
        return


async def _stream_once(history: list[dict], system_prompt: str) -> AsyncIterator[str]:
    """Один заход в модель: отдаёт дельты текста по мере генерации."""
    url, payload, headers = _build_request(history, system_prompt, stream=True)

    total_chars = 0
    async with _client.stream("POST", url, json=payload, headers=headers) as response:
        response.raise_for_status()
        # SSE-формат: строки "data: {json}", финальный маркер "data: [DONE]"
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                chunk = json.loads(data)
            except ValueError:
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = (choices[0].get("delta") or {}).get("content")
            if delta:
                total_chars += len(delta)
                yield delta

    logger.info("LLM ответил (%d симв., стрим)", total_chars)
