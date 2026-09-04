"""Прогон итогового оценщика по готовому разговору из базы — для чтения глазами.

Зачем: отметки чек-листа тестами не проверить, у них нет «правильного
ответа», кроме реплик. Единственный честный способ понять, ставит ли модель
отметки по делу, — взять настоящую расшифровку, получить разбор и сверить
каждую отметку с цитатой. Скрипт печатает ровно это: пункт, отметку словом,
цитату и номер реплики.

Использует боевой код (scoring.review_conversation) и боевую базу — то есть
проверяет то самое, что случится после разговора. В базу ничего не пишет.

Запуск из папки backend (в контейнере — тот же путь):
    python scripts/review_transcript.py <session_id> [<session_id> ...]

Либо из файла — когда база с разговором недоступна (боевые расшифровки
на локальной машине до выкатки):
    python scripts/review_transcript.py --file <разговор.json> [...]
Файл: {"name", "prompt", "history": [{"role", "text"}], и необязательные
"rubric", "done_when", "stage_key", "scores_deal", "type_title"}.

Платно: один вызов итогового оценщика на разговор.
"""

import asyncio
import json
import os
import sys

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import get_settings  # noqa: E402
from services import checklist, scoring  # noqa: E402

# Сырой ответ модели — до сверки доказательств. Нужен, когда отметки
# сброшены: по нему видно, чья это ошибка — модель указала не ту реплику
# или наша нумерация её запутала
_сырые: list[dict] = []
_ask_json = scoring.ask_json


async def _ask_json_с_записью(*args, **kwargs):
    result = await _ask_json(*args, **kwargs)
    if result is not None:
        _сырые.append(result)
    return result


scoring.ask_json = _ask_json_с_записью


async def контекст(pool: asyncpg.Pool, session_id: str) -> tuple[dict, list[dict]]:
    """Роль пациента, тип тренировки и история — тем же составом, что в бою."""
    row = await pool.fetchrow(
        'SELECT p."name" AS patient_name, '
        'COALESCE(pc."prompt", p."prompt") AS patient_prompt, '
        't."rubric" AS rubric, t."doneWhen" AS done_when, '
        't."stageKey" AS stage_key, COALESCE(t."scoresDeal", true) AS scores_deal, '
        't."title" AS type_title '
        'FROM "Session" s '
        'LEFT JOIN "Patient" p ON p."id" = s."patientId" '
        'LEFT JOIN "TrainingType" t ON t."id" = s."trainingTypeId" '
        'LEFT JOIN "User" u ON u."id" = s."userId" '
        'LEFT JOIN "PatientCase" pc ON pc."patientId" = s."patientId" '
        '  AND pc."organizationId" = u."organizationId" '
        'WHERE s."id" = $1',
        session_id,
    )
    if row is None:
        raise SystemExit(f"сессии {session_id} нет в базе")
    rows = await pool.fetch(
        'SELECT "role"::text AS role, "text" FROM "Message" '
        'WHERE "sessionId" = $1 ORDER BY "createdAt" ASC',
        session_id,
    )
    return dict(row), [{"role": r["role"], "text": r["text"]} for r in rows]


def печать(review: scoring.FinalReview, history: list[dict]) -> None:
    print(
        f"ИСХОД {review.outcome} | общая {review.overall} | "
        f"контакт {review.stages.contact} лёд {review.stages.iceBreaker} "
        f"потребность {review.stages.needs} возражения {review.stages.objections} "
        f"закрытие {review.closing}"
        + (f" | зачтено: {review.drill_passed}" if review.drill_passed is not None else "")
    )
    for stage in review.checklist or []:
        title = checklist.STAGE_TITLES[stage["stage"]]
        if not stage["measured"]:
            print(f"\n== {title}: не измерен")
            continue
        total = sum(i["mark"] for i in stage["items"])
        print(f"\n== {title}: {total:.0f} / 10")
        for item in stage["items"]:
            слово = checklist.MARK_WORDS[item["mark"]]
            print(f"  [{item['mark']}] {item['n']:>2}. {item['name']} — {слово}")
            if item["msg"] is not None:
                print(f"        реплика #{item['msg']}: «{history[item['msg']]['text']}»")
    if _сырые:
        сырой = _сырые[-1]
        print("\nсырой ответ модели (до сверки доказательств):")
        for key, marks in (сырой.get("marks") or {}).items():
            evidence = (сырой.get("evidence") or {}).get(key)
            print(f"  {key}: marks={marks} evidence={evidence}")
    print(f"\nсильное место: {review.strength}")
    print(f"точка роста:   {review.growth_point}")
    print(f"разбор для нас: {review.judge_notes}")


async def разобрать(метка: str, ctx: dict, history: list[dict]) -> None:
    print("=" * 78)
    print(
        f"{метка} · {ctx.get('patient_name') or ctx.get('name')} · "
        f"{ctx.get('type_title') or 'полный разговор'} · реплик {len(history)}"
    )
    if not history:
        print("реплик нет — разбирать нечего")
        return
    _сырые.clear()
    review = await scoring.review_conversation(
        history,
        ctx.get("patient_prompt") or ctx.get("prompt") or "",
        rubric=ctx.get("rubric"),
        done_when=ctx.get("done_when"),
        scores_deal=bool(ctx.get("scores_deal", True)),
        stage_key=ctx.get("stage_key"),
    )
    if review is None:
        print("оценщик не вернул разбор")
        return
    печать(review, history)


async def main() -> None:
    args = sys.argv[1:]
    if not args:
        raise SystemExit("нужен session_id или --file <разговор.json>")

    if args[0] == "--file":
        for path in args[1:]:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            await разобрать(os.path.basename(path), data, data.get("history") or [])
        return

    settings = get_settings()
    pool = await asyncpg.create_pool(dsn=settings.asyncpg_dsn, min_size=1, max_size=2)
    try:
        for session_id in args:
            ctx, history = await контекст(pool, session_id)
            await разобрать(session_id, ctx, history)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
