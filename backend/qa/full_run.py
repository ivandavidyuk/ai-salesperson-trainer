"""Полный разговор со всеми пациентами клиники: менеджер — модель, сделка как в бою.

    python -m qa.full_run <id организации> [--patients слаг,слаг] [--turns 32]
        [--concurrency 5] [--diag-at 7] [--out qa-runs/имя]

Зачем отдельно от qa.run. Там полный разговор — одиннадцать ходов и без
строки доверия: до закрытия он не доходит, а согласие пациента без механизма
сделки ничего не говорит. Здесь до тридцати двух ходов и всё боевым кодом:
строка доверия по фоновой оценке после каждого хода (как TurnManager
в main.py), документ диагностики на заданном ходу (как кнопка «Результат
диагностики»), итоговый разбор. Читателя-модели нет — расшифровки читаем
сами: 14.10 так нашлось шесть видов брака при отличных оценках
(docs/NOTES.md, «Прогон Jamaica: 21 полный разговор»).

Что видит менеджер-модель — ровно то, что живой: карточку, прайс, анамнез
(промпт_менеджера из qa.conversation) и как устроена его клиника. После
документа — заключение и назначенное лечение с ценой. Условий согласия
пациента не видит.

Ограничения — знать, читая результат:
- менеджер-модель слабый продавец: на первое «нет» сдаётся, вариант
  подешевле из прайса сам не ищет. Отказ — не довод, что пациента
  не закрыть: закрываемость судить по случаю;
- документ привязан к номеру хода, а не к сцене: если менеджер раньше
  скажет «вы вернулись от врача», пациент сочинит заключение сам. Живой
  менеджер может сделать так же — это находка про роль, а не только
  про прогон;
- голоса, пауз и перебиваний здесь нет.

Цена 14.10: $0,885 за 21 разговор по счётчику, из них ~$0,25 — уходы
к резервной Haiku (вдесятеро дороже Gemini). Счётчик OpenRouter печатается
до и после. Платный — запускать с названной ценой и согласия Ивана.

Запуск внутри backend-контейнера на DE, в фоне:

    docker exec -d ai-trainer-backend-1 sh -c \\
      'cd /app && python -m qa.full_run <org> > /tmp/full.log 2>&1'

Результаты живут в контейнере (qa-runs/…) и стираются деплоем — забирать
сразу (`docker cp`). Деплой посреди прогона его обрывает.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncpg  # noqa: E402
import httpx  # noqa: E402

from core.config import get_settings  # noqa: E402
from services import llm, scoring  # noqa: E402

from qa import store  # noqa: E402
from qa.conversation import _ответ, _реплика_менеджера, промпт_менеджера  # noqa: E402

_ПАУЗА_ХОДА = 1.5

# Что менеджер этой клиники знает о своём процессе. Ключа к пациенту здесь
# нет: условия согласия — в роли. Первая фраза — от сбоя 14.10: без неё
# модель играла администратора, записала ФИО и дату рождения, проводила
# к врачу и закончила разговор на четвёртом ходу
_НЕ_АДМИНИСТРАТОР = (
    "Ты менеджер по продажам, а не администратор: карту, документы и запись "
    "к врачу ведёт регистратура, этим ты не занимаешься. "
)
_ПРОЦЕСС = {
    # Вариант правил «акция» (ВАРИАНТЫ_ПРАВИЛ в frontend/scripts/patient-prompt.ts)
    "акция": (
        "Как устроена твоя клиника. Пациент пришёл по рекламной акции: осмотр "
        "врача и УЗИ бесплатно, одна процедура аутоплазмы в подарок — её сделают "
        "в любом случае. Ты встречаешь пациента до врача: знакомишься и выясняешь, "
        "что беспокоит. Потом он идёт к врачу, а ты получаешь заключение и "
        "назначенный курс. Курс оплачивают целиком в тот же день: наличными, "
        "картой, в рассрочку банка или клиники.\n\n"
    ),
    None: (
        "Как устроена твоя клиника. Пациент пришёл на приём, оплаченный заранее. "
        "Ты встречаешь пациента до врача: знакомишься и выясняешь, что беспокоит. "
        "Потом он идёт на диагностику, а ты получаешь заключение и назначенное "
        "лечение.\n\n"
    ),
}
_ДО_ВРАЧА = (
    "Сейчас пациент ещё не был у врача: заключения у тебя нет, лечение пока "
    "не предлагай. До врача твоя задача — познакомиться, расположить к себе "
    "и выяснить, что беспокоит и как это мешает жить. К врачу его не "
    "отправляй и разговор не заканчивай: когда придёт время, он сходит "
    "и вернётся с заключением."
)
# Закончить можно только после врача: до заключения продавать нечего,
# и ранний «конец» обрывал прогон на знакомстве
_КОНЕЦ = (
    "Когда разговор окончен — пациент оплатил или окончательно отказался и "
    "уходит, — вместо реплики напиши одно слово: КОНЕЦ."
)


def конец_разговора(строка: str) -> tuple[bool, str]:
    """Сказал ли менеджер «КОНЕЦ» и что осталось от реплики без него."""
    чистая = строка.rstrip(".! ")
    if not чистая.upper().endswith("КОНЕЦ"):
        return False, строка
    остаток = чистая[:-5].strip()
    return not остаток, остаток


async def _счётчик() -> float:
    s = get_settings()
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(
            f"{s.llm_base_url}/auth/key", headers={"Authorization": f"Bearer {s.llm_api_key}"}
        )
        return float(r.json()["data"]["usage"])


async def _клиника_и_документы(org_id: str) -> tuple[str | None, dict]:
    """Вариант правил организации и по пациенту: документ, услуга, цена."""
    pool = await asyncpg.create_pool(dsn=get_settings().asyncpg_dsn, min_size=1, max_size=2)
    try:
        вариант = await pool.fetchval(
            'SELECT "rulesVariant" FROM "Organization" WHERE "id" = $1', org_id
        )
        строки = await pool.fetch(
            'SELECT p."name", pc."diagnosticsPreset" AS doc, pc."serviceName" AS service, '
            's."price" AS price FROM "PatientCase" pc '
            'JOIN "Patient" p ON p."id" = pc."patientId" '
            'LEFT JOIN "Service" s ON s."organizationId" = pc."organizationId" '
            '  AND s."name" = pc."serviceName" '
            'WHERE pc."organizationId" = $1',
            org_id,
        )
    finally:
        await pool.close()
    return вариант, {с["name"]: dict(с) for с in строки}


def _в_словарь(объект):
    if объект is None:
        return None
    if hasattr(объект, "model_dump"):
        return объект.model_dump()
    return getattr(объект, "__dict__", str(объект))


async def _разговор(пациент, тип, клиника, док, процесс, args, каталог: Path) -> dict:
    роль = llm.build_system_prompt(пациент.промпт, тип.промпт)
    база_менеджера = промпт_менеджера(тип, клиника, пациент)
    отрасль = клиника.ключ
    порог = get_settings().deal_score_threshold
    история: list[dict] = []
    ходы, сбои = [], []
    scores = None
    документ_показан = False
    начало = time.monotonic()

    for номер in range(1, args.turns + 1):
        if номер == args.diag_at and док and док.get("doc"):
            документ_показан = True
        if документ_показан:
            лечение = f"{док['service']} — {док['price']}" if док.get("service") else "не назначено"
            менеджеру = (
                f"{процесс}Пациент вернулся от врача. Заключение врача у тебя "
                f"на экране:\n{док['doc']}\n\nНазначено: {лечение}.\n\n{_КОНЕЦ}"
            )
        else:
            менеджеру = процесс + _ДО_ВРАЧА
        роль_менеджера = f"{база_менеджера}\n\n{_НЕ_АДМИНИСТРАТОР}{менеджеру}"

        try:
            строка = (await _реплика_менеджера(история, роль_менеджера)).strip()
        except Exception as exc:  # noqa: BLE001
            сбои.append({"ход": номер, "кто": "менеджер", "ошибка": f"{type(exc).__name__}: {exc}"[:300]})
            continue
        if not строка:
            сбои.append({"ход": номер, "кто": "менеджер", "ошибка": "пусто"})
            continue
        if документ_показан:
            стоп, строка = конец_разговора(строка)
            if стоп:
                break

        # Строка доверия — как в TurnManager: по последней фоновой оценке
        reached = scores is not None and scores.average >= порог
        промпт = f"{роль}\n\n{llm.trust_instruction(reached, отрасль)}"
        if документ_показан:
            промпт = f"{промпт}\n\n{llm.diagnostics_instruction(док['doc'])}"

        история.append({"role": "user", "text": строка})
        try:
            ответ, первый_мс, _ = await _ответ(история, промпт)
        except Exception as exc:  # noqa: BLE001
            история.pop()
            сбои.append({"ход": номер, "кто": "пациент", "ошибка": f"{type(exc).__name__}: {exc}"[:300]})
            continue
        if not ответ:
            история.pop()
            сбои.append({"ход": номер, "кто": "пациент", "ошибка": "пусто"})
            continue
        история.append({"role": "assistant", "text": ответ})
        ходы.append({
            "ход": номер, "менеджер": строка, "пациент": ответ, "первый_мс": первый_мс,
            "доверие": reached, "документ": документ_показан,
            "оценка": scores.average if scores else None,
        })
        await asyncio.sleep(_ПАУЗА_ХОДА)
        scores = await scoring.score_stages(история, роль, industry=отрасль) or scores

    try:
        разбор = await scoring.review_conversation(
            история, роль, rubric=тип.рубрика or None, done_when=тип.критерий or None,
            scores_deal=True, stage_key=тип.ключ_этапа, type_id=тип.слаг, industry=отрасль,
        )
    except Exception as exc:  # noqa: BLE001
        разбор = None
        сбои.append({"ход": None, "кто": "разбор", "ошибка": f"{type(exc).__name__}: {exc}"[:300]})

    итог = {
        "пациент": пациент.имя, "слаг": пациент.слаг,
        "курс": док.get("service") if док else None, "цена": док.get("price") if док else None,
        "ходов": len(ходы), "секунд": round(time.monotonic() - начало), "сбои": сбои,
        "последняя_оценка": _в_словарь(scores), "разбор": _в_словарь(разбор), "ходы": ходы,
    }
    (каталог / f"{пациент.слаг}.json").write_text(
        json.dumps(итог, ensure_ascii=False, indent=1, default=str), encoding="utf-8"
    )
    исход = (итог["разбор"] or {}).get("outcome")
    print(f"готов {пациент.слаг}: ходов {len(ходы)}, сбоев {len(сбои)}, исход {исход}", flush=True)
    return итог


async def main() -> None:
    п = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    п.add_argument("org", help="id организации — её случаи, прайс и вариант правил")
    п.add_argument("--patients", help="слаги через запятую; по умолчанию все со случаем")
    п.add_argument("--turns", type=int, default=32)
    п.add_argument("--concurrency", type=int, default=5)
    п.add_argument("--diag-at", type=int, default=7, help="на каком ходу показать документ")
    п.add_argument("--out", default=f"qa-runs/full-{time.strftime('%Y-%m-%dT%H-%M')}")
    args = п.parse_args()

    пациенты, типы, клиника, _ = await store.загрузить(args.org)
    if клиника is None or клиника.ключ != "медицина":
        raise SystemExit("Только клиники: у неклиники нет документа диагностики")
    пациенты = [x for x in пациенты if x.случай_собран]
    if args.patients:
        нужные = set(args.patients.split(","))
        пациенты = [x for x in пациенты if x.слаг in нужные]
    тип = next(т for т in типы if т.считает_сделку)
    вариант, доки = await _клиника_и_документы(args.org)
    процесс = _ПРОЦЕСС.get(вариант, _ПРОЦЕСС[None])
    каталог = Path(args.out)
    каталог.mkdir(parents=True, exist_ok=True)
    print(
        f"клиника «{клиника.название}», вариант правил {вариант or 'нет'}, тип «{тип.название}», "
        f"пациентов {len(пациенты)}, ходов до {args.turns}, документ на {args.diag_at}-м, "
        f"каталог {каталог}",
        flush=True,
    )

    до = await _счётчик()
    семафор = asyncio.Semaphore(args.concurrency)

    async def один(x):
        async with семафор:
            try:
                return await _разговор(x, тип, клиника, доки.get(x.имя), процесс, args, каталог)
            except Exception as exc:  # noqa: BLE001
                print(f"СБОЙ {x.слаг}: {type(exc).__name__}: {exc}", flush=True)
                return None

    итоги = [и for и in await asyncio.gather(*(один(x) for x in пациенты)) if и]
    после = await _счётчик()
    сводка = {
        "потрачено": round(после - до, 4), "пациентов": len(итоги),
        "исходы": {и["слаг"]: (и["разбор"] or {}).get("outcome") for и in итоги},
    }
    (каталог / "summary.json").write_text(
        json.dumps(сводка, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"ГОТОВО: {len(итоги)} разговоров, потрачено ${после - до:.4f}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
