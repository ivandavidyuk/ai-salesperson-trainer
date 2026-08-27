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
from services import usage

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


class ProviderRefused(RuntimeError):
    """Провайдер ответил HTTP 200, но текста не дал.

    Так приходит 429 «temporarily rate-limited upstream»: заголовки успешные,
    внутри потока — choices[0].finish_reason=error и ни одной дельты.

    Отдельный класс нужен, потому что от честного пустого ответа этот случай
    отличается лечением: пустой ответ повторять бессмысленно, отказ провайдера
    повторить надо. Раньше их не различали, и ход терялся молча —
    см. stream_reply.
    """

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


# Результат диагностики — второе динамическое знание пациента после доверия.
# Появляется в промпте, только когда менеджер открыл документ кнопкой:
# до того пациент «на диагностику ещё не сходил», и знать итог ему неоткуда.
#
# «Условия согласия итог не отменяет» — предохранитель с двух сторон разом:
# при ухудшении пациент не должен сдаваться от испуга (сделку по-прежнему
# закрывает менеджер), а при исходе «без изменений» — получать законный
# повод сказать «раз всё стабильно, подожду» и торговаться дальше.
_DIAGNOSTICS_HEADER = "РЕЗУЛЬТАТ ДИАГНОСТИКИ:"

_DIAGNOSTICS_RULES = (
    "Ты только что вернулась с диагностики, распечатка с результатом — "
    "у менеджера, и он видит её текст. Ты знаешь свой итог (он выше). "
    "Вслух цифры и термины из распечатки не зачитывай — ты не врач; "
    "если менеджер спросит о результате прямо, отвечай в духе «врач "
    "распечатку дал, вот, посмотрите» и говори об итоге своими словами, "
    "как его поняла. Реагируй на итог по своему характеру, но условия "
    "твоего согласия он не отменяет."
)


def diagnostics_instruction(document: str) -> str:
    """Блок про результат диагностики — подмешивается после показа документа."""
    return f"{_DIAGNOSTICS_HEADER}\n{document.strip()}\n\n{_DIAGNOSTICS_RULES}"


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


# Ручка размышления у каждого вендора своя, и одно значение на всех
# не работает. Замерено 31.07.2026:
#
#   gemini-2.5-flash-lite  enabled=false 409 мс; effort=minimal ломает ответ
#                          до шестнадцати символов
#   gemini-3.5-flash-lite  enabled=false — HTTP 400 «Reasoning is mandatory»;
#                          effort=minimal 430 мс
#   claude-haiku-4.5       exclude=true 997 мс, ровнее прочих по хвосту
#
# Пока значение было одно, замер кандидатов мерил не модели, а нашу
# конфигурацию: часть их думала, когда не просили, часть получала отказ.
_РАЗМЫШЛЕНИЕ: dict[str, dict] = {
    "google/gemini-3.5": {"effort": "minimal"},
    "anthropic/": {"exclude": True},
}
_РАЗМЫШЛЕНИЕ_ПО_УМОЛЧАНИЮ = {"enabled": False}


def reasoning_for(model: str) -> dict:
    """Настройка размышления под конкретную модель."""
    for префикс, значение in _РАЗМЫШЛЕНИЕ.items():
        if model.startswith(префикс):
            return значение
    return _РАЗМЫШЛЕНИЕ_ПО_УМОЛЧАНИЮ


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
        # Размышление глушим: для ролевого диалога оно не нужно, а без него
        # первый токен приходит за ~400 мс вместо 1-3+ с. Ручка зависит
        # от модели — см. reasoning_for
        "reasoning": reasoning_for(settings.llm_model),
    }
    if stream:
        # Просим провайдера прислать usage финальным чанком. Без этого расход
        # стрима не виден вовсе, и посчитать его можно только на глаз —
        # 04.08 такая прикидка разошлась со счётом кратно
        payload["stream_options"] = {"include_usage": True}
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
    settings = get_settings()
    # Второй заход — резервной моделью другого вендора. Повтор той же попадёт
    # в тот же шторм: отказы у провайдера приходят пачками, а не поодиночке
    модели = [settings.llm_model]
    if settings.fallback_model:
        модели.append(settings.fallback_model)
    else:
        модели.append(settings.llm_model)

    for attempt in range(1, _STREAM_ATTEMPTS + 1):
        model = модели[min(attempt, len(модели)) - 1]
        stream = _stream_once(history, system_prompt, model)
        # Потолок вешаем только на первый токен: дальше модель уже говорит,
        # и обрывать её на середине фразы нельзя. Повтор при этом безопасен
        # по построению — до первой дельты в синтез ничего не ушло
        try:
            first = await asyncio.wait_for(
                stream.__anext__(), _FIRST_TOKEN_TIMEOUT_SEC
            )
        except StopAsyncIteration:
            await stream.aclose()
            # Пустой ответ без ошибки. Раньше здесь стоял выход по причине
            # «модель сказала ничего — повторять нечего», и это стоило нам
            # от двух до пяти ходов из десяти: HTTP 200, finish_reason=stop
            # и ноль символов — так у Gemini выглядит сбой, а не решение
            # промолчать. Резерв на маршрутизации OpenRouter такое не ловит:
            # для него ответ успешен. Поэтому ловим сами и идём к резерву
            if attempt == _STREAM_ATTEMPTS:
                logger.warning("LLM (%s) вернула пустой ответ и на повторе", model)
                return
            logger.warning(
                "LLM (%s) вернула пустой ответ — идём к резерву (%s)",
                model,
                модели[attempt],
            )
            continue
        except ProviderRefused as exc:
            await stream.aclose()
            if attempt == _STREAM_ATTEMPTS:
                logger.warning("LLM (%s) отказала и на повторе: %s", model, exc)
                raise
            logger.warning(
                "LLM (%s) отказала (%s) — идём к резерву (%s)",
                model,
                exc,
                модели[attempt],
            )
            continue
        except asyncio.TimeoutError:
            await stream.aclose()  # закрываем повисшее соединение
            if attempt == _STREAM_ATTEMPTS:
                logger.warning(
                    "LLM (%s) молчала дольше %.1f с и на повторе",
                    model,
                    _FIRST_TOKEN_TIMEOUT_SEC,
                )
                raise
            logger.warning(
                "LLM (%s) молчит дольше %.1f с — идём к резерву (%s)",
                model,
                _FIRST_TOKEN_TIMEOUT_SEC,
                модели[attempt],
            )
            continue

        yield first
        async for delta in stream:
            yield delta
        return


async def _stream_once(
    history: list[dict], system_prompt: str, model: str | None = None
) -> AsyncIterator[str]:
    """Один заход в модель: отдаёт дельты текста по мере генерации."""
    url, payload, headers = _build_request(history, system_prompt, stream=True)
    if model:
        # Резервная модель другого вендора — и ручка размышления у неё своя
        payload["model"] = model
        payload["reasoning"] = reasoning_for(model)

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
            # Учёт токенов приезжает отдельным чанком в самом конце потока —
            # в нём usage есть, а choices пустой. Ловим до всех прочих веток,
            # иначе он утонет в «choices нет, идём дальше»
            if chunk.get("usage"):
                usage.записать(payload.get("model", "?"), chunk["usage"])

            choices = chunk.get("choices") or []
            choice = choices[0] if choices else {}
            # Отказ провайдера приезжает внутри успешного ответа: HTTP 200,
            # finish_reason=error и ни одной дельты. Пока эту ветку не читали,
            # поток просто кончался, stream_reply видел «модель ничего
            # не сказала» и выходил без лога и без повтора — ход исчезал
            # бесследно. Ровно так теряется каждый третий ход при 429 у Google
            refusal = chunk.get("error") or choice.get("error")
            if choice.get("finish_reason") == "error" or (refusal and not choices):
                if total_chars:
                    # На середине фразы повтор небезопасен: часть текста уже
                    # ушла в синтез. Обрываем и оставляем след в логе
                    logger.warning("LLM оборвалась после %d симв.: %s", total_chars, refusal)
                    return
                raise ProviderRefused(str(refusal or "причина не указана")[:200])
            if not choices:
                continue
            delta = (choice.get("delta") or {}).get("content")
            if delta:
                total_chars += len(delta)
                yield delta

    logger.info("LLM ответил (%d симв., стрим)", total_chars)
