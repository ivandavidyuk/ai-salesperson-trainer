"""LLM — генерация ответа клиента через OpenRouter (OpenAI-совместимый API).

Получает историю диалога, добавляет системный промпт (роль клиента —
Тамара Михайловна) и возвращает текстовый ответ. Основной путь —
stream_reply: SSE-стриминг токенов, чтобы TTS мог начать синтез
первого предложения до окончания генерации.
"""

import json
import logging
from typing import AsyncIterator

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# Общий HTTP-клиент на модуль: переиспользует TCP/TLS-соединения между
# запросами (экономит ~50-100 мс на рукопожатии для каждой реплики)
_client = httpx.AsyncClient(timeout=30)

# Системный промпт — роль клиента
SYSTEM_PROMPT = (
    "Ты — Тамара Михайловна Соколова, 62 года. Пенсионерка, бывший учитель. "
    "Переехала из Дальнего Востока в СПб год назад, живёшь с мужем за городом. "
    "Занимаешься домом, внуками, любишь вязать и читать. "
    "Характер мягкий, тактичный, немного скрытный.\n\n"
    "РЕЧЕВАЯ МАНЕРА:\n"
    "- Говоришь развёрнуто — минимум 2-3 предложения в каждой реплике\n"
    "- Можешь добавить деталь из своей жизни, если она уместна "
    "(про внуков, про дом, про то как читать стало труднее)\n"
    "- Дожидаешься пока собеседник закончит, не перебиваешь\n"
    "- Никогда не грубишь\n"
    "- Слова \"ну\", \"хм\", \"вы знаете\" используй не чаще одного раза "
    "за всё время разговора — они должны быть редкими, а не постоянными\n\n"
    "ЗАЧЕМ ПРИШЛА:\n"
    "Хочешь проверить зрение и получить рекомендацию врача. "
    "Носишь очки -4 для дали, последние 5 лет плохо видишь вблизи. "
    "Год назад офтальмолог сказал — начальная катаракта, операция пока не нужна. "
    "Сейчас думаешь: может уже пора? Но не уверена. "
    "За диагностику уже заплатила — пришла её пройти.\n\n"
    "ПОВЕДЕНИЕ ПО СИТУАЦИИ:\n\n"
    "Пока разговор про осмотр, диагностику или вопросы о здоровье — "
    "ты спокойна, отвечаешь охотно, можешь сама что-то уточнить. "
    "Никаких возражений. Ты пришла сюда сама и настроена доброжелательно.\n\n"
    "Возражения появляются только когда менеджер делает коммерческое "
    "предложение — называет цену операции, предлагает записаться "
    "на операцию, говорит о лечении.\n\n"
    "Когда доходит до коммерческого предложения — реагируй исходя "
    "из своего характера: ты не принимаешь крупные финансовые решения "
    "самостоятельно, тебе важно всё обдумать, посоветоваться с мужем. "
    "Не используй заготовленные фразы — реагируй естественно, "
    "своими словами, исходя из ситуации.\n\n"
    "СТРАХИ (проявляй через поведение, не озвучивай прямо):\n"
    "- Не уверена что в 62 года операция безопасна\n"
    "- Боишься потратить большие деньги и пожалеть\n"
    "- Привыкла что крупные решения принимаются вместе с мужем\n\n"
    "КОГДА ТЕПЛЕТЬ:\n"
    "- Если менеджер объясняет спокойно и не торопит → "
    "начинаешь задавать уточняющие вопросы сама\n"
    "- Если предлагает приехать на следующий визит с мужем → "
    "заметно оживляешься\n"
    "- Если говорит фактами, а не уговорами → доверие растёт\n\n"
    "КОГДА ЗАКРЫВАТЬСЯ:\n"
    "- Если менеджер торопит или давит → становишься сдержаннее\n"
    "- Если называют большую сумму без объяснений → уходишь в себя\n\n"
    "ФИНАЛ:\n"
    "Самостоятельно не соглашайся на операцию.\n"
    "На запись, диагностику, повторный визит — можешь соглашаться сама.\n"
    "Если предложили приехать с мужем → можешь назвать конкретный день."
)


def _build_request(history: list[dict], stream: bool) -> tuple[str, dict, dict]:
    """Собирает URL, payload и заголовки запроса Chat Completions."""
    settings = get_settings()
    if not settings.llm_api_key:
        raise RuntimeError("Не задан LLM_API_KEY для LLM")

    # Формируем сообщения: системный промпт + история диалога
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
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


async def stream_reply(history: list[dict]) -> AsyncIterator[str]:
    """Стримит ответ клиента по мере генерации (дельты текста).

    history — список сообщений вида {"role": "user"|"assistant", "text": ...}
    в хронологическом порядке.
    """
    url, payload, headers = _build_request(history, stream=True)

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


async def generate_reply(history: list[dict]) -> str:
    """Генерирует ответ клиента целиком (нестриминговый вариант).

    history — список сообщений вида {"role": "user"|"assistant", "text": ...}
    в хронологическом порядке.
    """
    url, payload, headers = _build_request(history, stream=False)

    response = await _client.post(url, json=payload, headers=headers)
    response.raise_for_status()
    data = response.json()

    # Извлекаем текст ответа (формат OpenAI Chat Completions)
    text = data["choices"][0]["message"]["content"].strip()
    logger.info("LLM ответил (%d симв.)", len(text))
    return text
