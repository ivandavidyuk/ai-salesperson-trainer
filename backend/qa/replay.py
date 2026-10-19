"""Повтор хода: тот же разговор до нужной реплики, новый ответ пациента K раз.

    python -m qa.replay <набор.json> [--k 8] [--место промпт|система|пометка]
        [--роли <папка>] [--до-документа] [--out <файл>]

Зачем. Дефект персонажа случается на конкретном ходу: Игорь соглашается
оплатить на 19-м, Николай выкладывает биографию на третьем. Полный прогон
ради одного хода дорог, а один ответ ничего не говорит о частоте. Здесь
история до хода берётся из расшифровки, а ответ на него просим K раз —
«было / стало» меряется ровно там, где сломалось, по центу за десяток.

Набор — JSON-список случаев:
    {"имя": "Игорь@19: согласие при доверии false",
     "org": "<id организации>", "пациент": "Игорь Владимирович",
     "источник": "<расшифровка qa.full_run>.json" | "сессия": "<id или начало id>",
     "ход": 19, "ищем": "оплач|оформ|давайте"}
У расшифровки qa.full_run «ход» — номер хода в ней, доверие и документ
берутся из него же. У живой сессии — какая по счёту реплика менеджера;
доверия там нет (этапная тренировка), а для полного разговора его можно
задать полем "доверие". «ищем» — регулярка-подсказка, а не вердикт:
согласие по-русски говорится десятком способов, ответы читать глазами.

Роль — из базы (как в бою) или из выгрузки `npm run dump:prompts` с ветки:
--роли указывает на папку отрасли выгрузки, файл — «<имя пациента>.txt».
Сборка хода — llm.собрать_ход, тот же код, что в TurnManager.

Запуск внутри backend-контейнера на DE, с FALLBACK_MODEL="": меряем боевую
модель, а не резерв. Счётчик OpenRouter печатается до и после.
Платный — с названной ценой и согласия Ивана.
"""

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncpg  # noqa: E402

from core.config import get_settings  # noqa: E402
from services import llm  # noqa: E402
from services.industry import есть_диагностика  # noqa: E402

from qa import store  # noqa: E402
from qa.store import применить_замены  # noqa: E402
from qa.conversation import _ответ  # noqa: E402
from qa.full_run import _клиника_и_документы, _счётчик  # noqa: E402


async def _сессия(префикс: str) -> tuple[str | None, list[dict]]:
    """Тип тренировки сессии и её реплики по порядку."""
    pool = await asyncpg.create_pool(dsn=get_settings().asyncpg_dsn, min_size=1, max_size=2)
    try:
        строка = await pool.fetchrow(
            'SELECT "id", "trainingTypeId" FROM "Session" WHERE "id" LIKE $1 || \'%\'', префикс
        )
        if строка is None:
            raise SystemExit(f"Сессия {префикс} не найдена")
        реплики = await pool.fetch(
            'SELECT "role", "text" FROM "Message" WHERE "sessionId" = $1 ORDER BY "createdAt", "id"',
            строка["id"],
        )
    finally:
        await pool.close()
    return строка["trainingTypeId"], [{"role": str(r["role"]), "text": r["text"]} for r in реплики]


def _до_хода_расшифровки(ходы: list[dict], номер: int) -> tuple[list[dict], dict]:
    """История до хода расшифровки qa.full_run и запись самого хода."""
    история = []
    for х in ходы:
        if х["ход"] == номер:
            история.append({"role": "user", "text": х["менеджер"]})
            return история, х
        история += [
            {"role": "user", "text": х["менеджер"]},
            {"role": "assistant", "text": х["пациент"]},
        ]
    raise SystemExit(f"В расшифровке нет хода {номер}")


def _до_реплики_сессии(реплики: list[dict], номер: int) -> tuple[list[dict], str]:
    """История до N-й реплики менеджера живой сессии и прежний ответ на неё."""
    счёт = 0
    for i, р in enumerate(реплики):
        if р["role"] == "user":
            счёт += 1
            if счёт == номер:
                прежний = реплики[i + 1]["text"] if i + 1 < len(реплики) else ""
                return реплики[: i + 1], прежний
    raise SystemExit(f"В сессии нет {номер}-й реплики менеджера")


async def _случай(случай: dict, args, кэш: dict) -> dict:
    org = случай["org"]
    if org not in кэш:
        пациенты, типы, клиника, _ = await store.загрузить(org)
        _, доки = await _клиника_и_документы(org)
        кэш[org] = (пациенты, типы, клиника, доки)
    пациенты, типы, клиника, доки = кэш[org]
    пациент = next(п for п in пациенты if п.имя == случай["пациент"])
    роль = пациент.промпт
    if args.роли:
        роль = (Path(args.роли) / f"{пациент.имя}.txt").read_text(encoding="utf-8")
    роль = применить_замены(роль, кэш.get("_замены", []), случай["имя"])

    документ = None
    if "источник" in случай:
        записи = json.loads(Path(случай["источник"]).read_text(encoding="utf-8"))
        история, ход = _до_хода_расшифровки(записи["ходы"], случай["ход"])
        тип = next(т for т in типы if т.считает_сделку)
        доверие = случай.get("доверие", ход["доверие"])
        if ход["документ"]:
            документ = (доки.get(пациент.имя) or {}).get("doc")
        прежний = ход["пациент"]
    else:
        тип_id, реплики = await _сессия(случай["сессия"])
        история, прежний = _до_реплики_сессии(реплики, случай["ход"])
        тип = next(т for т in типы if т.слаг == тип_id)
        доверие = случай.get("доверие") if тип.считает_сделку else None

    система = llm.build_system_prompt(роль, тип.промпт)
    промпт, запрос = llm.собрать_ход(
        система, история, доверие=доверие, industry=клиника.ключ, документ=документ,
        до_документа=args.до_документа and тип.считает_сделку and есть_диагностика(клиника.ключ),
        место=args.место,
    )

    ищем = re.compile(случай["ищем"], re.I) if случай.get("ищем") else None
    семафор = кэш.setdefault("_семафор", asyncio.Semaphore(args.concurrency))

    async def один() -> str:
        async with семафор:
            try:
                текст, _, _ = await _ответ(запрос, промпт)
            except Exception as exc:  # noqa: BLE001
                текст = f"СБОЙ: {type(exc).__name__}"
            await asyncio.sleep(0.3)
            return текст

    ответы = await asyncio.gather(*(один() for _ in range(args.k)))
    попаданий = sum(1 for о in ответы if ищем and ищем.search(о))
    return {
        "имя": случай["имя"], "менеджер": история[-1]["text"], "прежний": прежний,
        "ответы": ответы, "ищем": случай.get("ищем"), "попаданий": попаданий,
        "доверие": доверие, "документ": bool(документ), "место": args.место or llm.МЕСТО_СОСТОЯНИЯ,
    }


async def main() -> None:
    п = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    п.add_argument("набор", help="JSON-список случаев")
    п.add_argument("--k", type=int, default=8, help="сколько ответов на случай")
    п.add_argument("--место", choices=llm.МЕСТА_СОСТОЯНИЯ, default=None)
    п.add_argument("--роли", help="папка отрасли из npm run dump:prompts; иначе — из базы")
    п.add_argument("--до-документа", dest="до_документа", action="store_true")
    п.add_argument("--замены", help="JSON-список {было, стало} — правка поверх роли")
    п.add_argument("--только", help="коды случаев через запятую (первое слово имени: A1,B2) — подмножество")
    п.add_argument("--concurrency", type=int, default=4)
    п.add_argument("--out", help="куда записать JSON с ответами")
    args = п.parse_args()

    случаи = json.loads(Path(args.набор).read_text(encoding="utf-8"))
    if args.только:
        нужные = set(args.только.split(","))
        случаи = [с for с in случаи if с["имя"].split()[0] in нужные]
    print(
        f"модель {get_settings().llm_model}, резерв «{get_settings().fallback_model}», "
        f"место {args.место or llm.МЕСТО_СОСТОЯНИЯ}, роли {args.роли or 'из базы'}, "
        f"замены {args.замены or 'нет'}, "
        f"до документа {'да' if args.до_документа else 'нет'}, по {args.k} ответов",
        flush=True,
    )
    до = await _счётчик()
    кэш: dict = {}
    if args.замены:
        кэш["_замены"] = json.loads(Path(args.замены).read_text(encoding="utf-8"))
    итоги = []
    for случай in случаи:
        итог = await _случай(случай, args, кэш)
        итоги.append(итог)
        отметка = f"  ищем «{итог['ищем']}»: {итог['попаданий']} из {args.k}" if итог["ищем"] else ""
        print(f"\n=== {итог['имя']}{отметка}\nМ: {итог['менеджер'][:300]}\nбыло: {итог['прежний'][:300]}", flush=True)
        for i, о in enumerate(итог["ответы"], 1):
            print(f"  {i}. {о[:400]}", flush=True)
    после = await _счётчик()
    print(f"\nПОТРАЧЕНО ${после - до:.4f}", flush=True)
    if args.out:
        Path(args.out).write_text(json.dumps(итоги, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
