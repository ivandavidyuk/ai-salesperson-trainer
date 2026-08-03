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
    python scripts/sim_conversation.py <промпт.txt> <реплики.txt> [тип]

Третий аргумент — слаг типа тренировки (`s3`, `intercept`, …). С ним прогон
идёт как этапная тренировка: блок этапа доклеивается к роли, механизм доверия
выключается, а разбор в конце отвечает «этап отработан или нет». Без него —
полный разговор со сделкой, как раньше.

Вместо файла реплик можно передать слово `llm` — тогда менеджера играет
модель. Это нужно там, где разговор ведёт ПАЦИЕНТ (отработка возражений,
перехват инициативы): заготовленный скрипт отвечает по своему плану и
попадает мимо заданного вопроса, а критерий требует ответа именно на него.
Модели-менеджеру даётся только описание упражнения — то же, что живой
менеджер читает на карточке. Ни рубрики, ни критерия: иначе прогон проверял
бы умение подогнать ответ под известную проверку.

Файл реплик: по реплике менеджера на абзац, абзацы разделены пустой строкой.
Строки, начинающиеся с #, игнорируются.
"""

import asyncio
import os
import re
import sys

import asyncpg

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


def имя_роли(role: str) -> str:
    """Подпись пациента в логе — из первой строки промпта «Ты — Имя ...».

    Раньше здесь стояло жёсткое «ТАМАРА», и все двадцать один пациент
    подписывались её именем: в пачке логов не разобрать, кто ответил.
    """
    совпадение = re.search(r"Ты\s+—\s+([А-ЯЁ][а-яё]+)", role)
    return (совпадение.group(1) if совпадение else "ПАЦИЕНТ").upper()


async def тип_тренировки(type_id: str) -> dict:
    """Настройки типа из базы — той же самой, откуда их берёт бой.

    Не из сида и не из копии в скрипте: сид перезаписывает базу, и копия
    разошлась бы незаметно. Прогон должен проверять то, что реально стоит
    у пациента, а не то, что мы думаем, что там стоит.
    """
    settings = get_settings()
    pool = await asyncpg.create_pool(dsn=settings.asyncpg_dsn, min_size=1, max_size=2)
    try:
        row = await pool.fetchrow(
            'SELECT "title", "description", "prompt", "rubric", "doneWhen", '
            '"stageKey", "scoresDeal" FROM "TrainingType" WHERE "id" = $1',
            type_id,
        )
    finally:
        await pool.close()
    if row is None:
        raise SystemExit(f"типа тренировки «{type_id}» нет в базе")
    return dict(row)


# Сколько ходов играет менеджер-модель. Скрипту длина задана файлом,
# а живому менеджеру её задавать нечем — берём столько же, сколько в наших
# сценариях, чтобы прогоны были сопоставимы
_ХОДОВ_У_МОДЕЛИ = 11


def промпт_менеджера(описание: str) -> str:
    """Роль менеджера для режима `llm`.

    Даём ровно то, что видит живой менеджер на карточке упражнения, —
    `description`. Ни рубрику, ни критерий: с ними прогон проверял бы
    не навык, а умение подогнать ответ под известную проверку.
    """
    return (
        "Ты — менеджер по продажам в частной клинике, разговариваешь "
        "с пациентом.\n\n"
        f"Сейчас ты отрабатываешь навык: {описание}\n\n"
        "Разговор идёт с середины: знакомство и рассказ о проблеме уже позади. "
        "Не здоровайся и не начинай сначала — продолжай с того, что говорит "
        "пациент. Оформлять и записывать сегодня не нужно, упражнение "
        "не про это.\n\n"
        "Говори как живой человек: коротко, одна мысль за реплику, без "
        "списков и заголовков. Отвечай на то, что пациент сказал прямо "
        "сейчас, а не по заготовленному плану.\n\n"
        "В ответе — только твоя реплика, без пояснений и без кавычек."
    )


async def реплика_менеджера(history: list[dict], prompt: str) -> str:
    """Ход менеджера-модели. История переворачивается: для него пациент — user."""
    зеркало = [
        {"role": "assistant" if item["role"] == "user" else "user", "text": item["text"]}
        for item in history
    ]
    if not зеркало:
        зеркало = [{"role": "user", "text": "(пациент молча ждёт, начни разговор)"}]
    return await collect_reply(зеркало, prompt)


async def main() -> None:
    role_path, lines_path = sys.argv[1], sys.argv[2]
    # Третий аргумент — слаг типа тренировки. Без него прогон идёт как раньше:
    # полный разговор со сделкой
    type_id = sys.argv[3] if len(sys.argv) > 3 else None

    with open(role_path, encoding="utf-8") as fh:
        role = fh.read()
    # Вместо файла реплик можно передать `llm` — тогда менеджера играет модель.
    # Это единственный способ проверить типы, где разговор ведёт ПАЦИЕНТ:
    # заготовленный скрипт отвечает по своему плану и попадает мимо вопроса,
    # а критерий требует ответа именно на заданное
    менеджер_модель = lines_path == "llm"
    lines = [] if менеджер_модель else load_lines(lines_path)
    подпись = имя_роли(role)

    settings = get_settings()
    threshold = settings.deal_score_threshold

    тип = await тип_тренировки(type_id) if type_id else None
    if тип is not None:
        # Склейка ровно как в бою (services/session.py): роль, потом блок этапа.
        # Своей склейки здесь нет и быть не должно — на разошедшемся порядке
        # мы уже обожглись 31.07
        role = llm.build_system_prompt(role, тип["prompt"])
    считаем_сделку = тип["scoresDeal"] if тип is not None else True

    print(f"роль: {len(role)} символов | модель: {settings.llm_model}")
    print(f"оценщик: {settings.scorer_model} | итоговый: {settings.final_scorer_model}")
    if тип is not None:
        print(f"тип: {тип['title']} ({type_id}) | сделка: {'да' if считаем_сделку else 'нет'}")
        print(f"критерий: {тип['doneWhen']}")
    if менеджер_модель:
        if тип is None:
            raise SystemExit("режим llm без типа: менеджеру нечего отрабатывать")
        роль_менеджера = промпт_менеджера(тип["description"])
        print(f"менеджера играет модель | ходов: {_ХОДОВ_У_МОДЕЛИ}")
        print(f"что он знает об упражнении: {тип['description']}\n")
    else:
        роль_менеджера = ""
        print(f"порог: {threshold} | реплик менеджера: {len(lines)}\n")

    history: list[dict] = []
    scores = None

    ходы = lines if not менеджер_модель else [None] * _ХОДОВ_У_МОДЕЛИ
    for number, line in enumerate(ходы, 1):
        # Состояние доверия — ровно как в TurnManager: по последней оценке.
        # В этапной тренировке строки нет вовсе: сделки не будет, решать роли
        # нечего, а лишний абзац сбивал бы её с упражнения
        if считаем_сделку:
            reached = scores is not None and scores.average >= threshold
            prompt = f"{role}\n\n{llm.trust_instruction(reached)}"
        else:
            prompt = role

        if менеджер_модель:
            try:
                line = await реплика_менеджера(history, роль_менеджера)
            except Exception as exc:  # noqa: BLE001
                print(f"     СБОЙ МЕНЕДЖЕРА: {type(exc).__name__}: {exc}\n")
                continue
            if not line:
                print("     менеджер промолчал — ход пропущен\n")
                continue

        print(f"[{number:2d}] МЕНЕДЖЕР  {line}")
        # Реплика менеджера уходит в историю ДО запроса — как в TurnManager
        # (main.py:759). Иначе роль отвечает на предыдущий ход, а история
        # заканчивается сообщением ассистента: чередование ролей нарушено.
        # gemini-2.5-flash-lite такое прощала, отвечая ПУСТО, а
        # gemini-3.5-flash-lite отвергает с HTTP 400. Отсюда взялись «два-пять
        # пустых ходов из десяти», которые я месяц приписывал нестабильности
        # модели: в бою их не было, они были только здесь
        history.append({"role": "user", "text": line})
        try:
            reply = await collect_reply(history, prompt)
        except Exception as exc:  # noqa: BLE001
            print(f"     СБОЙ РОЛИ: {type(exc).__name__}: {exc}\n")
            history.pop()  # ход не состоялся — не оставляем его в истории
            continue

        history.append({"role": "assistant", "text": reply})
        print(f"     {подпись:<9} {reply}")

        await asyncio.sleep(_TURN_PAUSE_SEC)
        if считаем_сделку:
            scores = await scoring.score_stages(history, role) or scores
        if считаем_сделку and scores is not None:
            mark = "ВЗЯТ" if scores.average >= threshold else "не взят"
            print(
                f"     оценка: контакт {scores.contact} лёд {scores.iceBreaker} "
                f"потребность {scores.needs} возражения {scores.objections} | "
                f"средняя {scores.average} | порог {mark}"
            )
        print()

    print("=" * 76)
    review = await scoring.review_conversation(
        history,
        role,
        rubric=тип["rubric"] if тип else None,
        done_when=тип["doneWhen"] if тип else None,
        scores_deal=считаем_сделку,
        stage_key=тип["stageKey"] if тип else None,
    )
    if review is None:
        print("ИТОГОВЫЙ РАЗБОР НЕ ПОЛУЧЕН")
        return
    if считаем_сделку:
        print(f"ИСХОД: {review.outcome}")
        print(
            f"оценки: контакт {review.stages.contact} лёд {review.stages.iceBreaker} "
            f"потребность {review.stages.needs} возражения {review.stages.objections} "
            f"закрытие {review.closing} | общая {review.overall}"
        )
    else:
        итог = "ОТРАБОТАН" if review.drill_passed else "НЕ ОТРАБОТАН"
        print(f"ЭТАП {итог} | оценка {review.overall}")
        print(f"полосы: {review.stages.as_dict()}")
    print(f"\nсильная сторона: {review.strength}")
    print(f"точка роста:     {review.growth_point}")
    print(f"\nразбор для нас:  {review.judge_notes}")


if __name__ == "__main__":
    asyncio.run(main())
