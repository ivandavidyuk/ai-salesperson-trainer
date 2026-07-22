"""LLM — генерация ответа клиента через OpenRouter (OpenAI-совместимый API).

Получает историю диалога и системный промпт, возвращает текст ответа
стримом: SSE-стриминг токенов позволяет TTS начать синтез первого
предложения до окончания генерации.

Роль клиента больше не зашита в код: промпт собирается из данных пациента
и типа тренировки (см. build_system_prompt) и приходит параметром.
"""

import json
import logging
from typing import AsyncIterator, Optional

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# Общий HTTP-клиент на модуль: переиспользует TCP/TLS-соединения между
# запросами (экономит ~50-100 мс на рукопожатии для каждой реплики)
_client = httpx.AsyncClient(timeout=30)

# Заголовок блока с инструкцией этапа сделки
_STAGE_HEADER = "ЭТАП РАЗГОВОРА:"


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
    """
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
