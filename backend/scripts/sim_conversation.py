"""Прогон разговора без голоса: реплики менеджера из файла, ответы — от модели.

Зачем: поведение пациента и работа механизма сделки к голосу отношения не имеют.
Это промпт плюс история реплик, а значит проверяется без микрофона, браузера
и живого человека. Голос нужен только для того, чтобы судить о голосе.

Использует продакшен-код, а не копию: llm.stream_reply, llm.trust_instruction,
scoring.score_stages, scoring.review_conversation. Поэтому проверяет то самое,
что случится в бою.

Чем отличается от живого разговора — честно:
  * нет STT, значит нет обрывов и склеек фраз;
  * реплики менеджера заданы заранее и не подстраиваются под ответ;
  * фоновый оценщик считается синхронно после каждого хода (в бою — в фоне,
    но так же по итогам предыдущего хода, поэтому состояние доверия совпадает).

Запуск из папки backend:
    python scripts/sim_conversation.py <промпт.txt> <реплики.txt>

Файл реплик: по реплике менеджера на абзац, абзацы разделены пустой строкой.
Строки, начинающиеся с #, игнорируются.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import get_settings  # noqa: E402
from services import llm, scoring  # noqa: E402


def load_lines(path: str) -> list[str]:
    with open(path, encoding="utf-8") as fh:
        raw = fh.read().replace("\r\n", "\n")
    blocks = []
    for block in raw.split("\n\n"):
        text = " ".join(
            line.strip()
            for line in block.strip().split("\n")
            if line.strip() and not line.startswith("#")
        )
        if text:
            blocks.append(text)
    return blocks


_ROLE_ATTEMPTS = 4
_RETRY_PAUSE_SEC = 3.0
# Пауза между ходами: в живом разговоре ходы разделены человеческой речью,
# а симулятор бьёт по API вплотную и сам себе устраивает лимит запросов
_TURN_PAUSE_SEC = 1.5


async def collect_reply(history: list[dict], system_prompt: str) -> str:
    """Ответ роли продакшен-кодом, но с терпеливыми повторами.

    В бою потерянный ход — это событие, которое надо видеть. Здесь наоборот:
    мы проверяем поведение, и сбой провайдера только портит прогон. Поэтому
    повторяем дольше, чем llm.stream_reply, — а его собственный потолок
    первого токена при этом остаётся нетронутым.
    """
    for attempt in range(1, _ROLE_ATTEMPTS + 1):
        parts: list[str] = []
        try:
            async for delta in llm.stream_reply(history, system_prompt):
                parts.append(delta)
        except Exception as exc:  # noqa: BLE001
            if attempt == _ROLE_ATTEMPTS:
                raise
            print(
                f"     (провайдер молчит — {type(exc).__name__}, "
                f"попытка {attempt} из {_ROLE_ATTEMPTS})"
            )
            await asyncio.sleep(_RETRY_PAUSE_SEC)
            continue
        reply = "".join(parts).strip()
        if reply:
            return reply
        if attempt == _ROLE_ATTEMPTS:
            return ""
        print(f"     (пустой ответ, попытка {attempt} из {_ROLE_ATTEMPTS})")
        await asyncio.sleep(_RETRY_PAUSE_SEC)
    return ""


async def main() -> None:
    role_path, lines_path = sys.argv[1], sys.argv[2]
    with open(role_path, encoding="utf-8") as fh:
        role = fh.read()
    lines = load_lines(lines_path)

    settings = get_settings()
    threshold = settings.deal_score_threshold
    print(f"роль: {len(role)} символов | модель: {settings.llm_model}")
    print(f"оценщик: {settings.scorer_model} | итоговый: {settings.final_scorer_model}")
    print(f"порог: {threshold} | реплик менеджера: {len(lines)}\n")

    history: list[dict] = []
    scores = None

    for number, line in enumerate(lines, 1):
        # Состояние доверия — ровно как в TurnManager: по последней оценке
        reached = scores is not None and scores.average >= threshold
        prompt = f"{role}\n\n{llm.trust_instruction(reached)}"

        print(f"[{number:2d}] МЕНЕДЖЕР  {line}")
        try:
            reply = await collect_reply(history, prompt)
        except Exception as exc:  # noqa: BLE001
            print(f"     СБОЙ РОЛИ: {type(exc).__name__}: {exc}\n")
            continue

        history.append({"role": "user", "text": line})
        history.append({"role": "assistant", "text": reply})
        print(f"     ТАМАРА    {reply}")

        await asyncio.sleep(_TURN_PAUSE_SEC)
        scores = await scoring.score_stages(history, role) or scores
        if scores is not None:
            mark = "ВЗЯТ" if scores.average >= threshold else "не взят"
            print(
                f"     оценка: контакт {scores.contact} лёд {scores.iceBreaker} "
                f"потребность {scores.needs} возражения {scores.objections} | "
                f"средняя {scores.average} | порог {mark}"
            )
        print()

    print("=" * 76)
    review = await scoring.review_conversation(history, role)
    if review is None:
        print("ИТОГОВЫЙ РАЗБОР НЕ ПОЛУЧЕН")
        return
    print(f"ИСХОД: {review.outcome}")
    print(
        f"оценки: контакт {review.stages.contact} лёд {review.stages.iceBreaker} "
        f"потребность {review.stages.needs} возражения {review.stages.objections} "
        f"закрытие {review.closing} | общая {review.overall}"
    )
    print(f"\nсильная сторона: {review.strength}")
    print(f"точка роста:     {review.growth_point}")
    print(f"\nразбор для нас:  {review.judge_notes}")


if __name__ == "__main__":
    asyncio.run(main())
