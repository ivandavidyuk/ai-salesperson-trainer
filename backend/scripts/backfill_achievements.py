"""Начисление достижений задним числом — по всей истории разговоров.

Механизм выдачи появился позже самих разговоров. Без этого прогона человек
с тридцатью тренировками увидел бы пустую полку и решил бы, что бейджи
не работают.

Дата получения берётся от разговора, на котором бейдж заработан, а не «сейчас»:
иначе у всех достижений оказалась бы одна дата, и «Есть контакт» выглядел бы
свежее «Рэмпейджа».

Бесплатно: моделей не зовёт, только читает базу и пишет в UserAchievement.
Идемпотентно: повторный запуск ничего не задвоит и не сдвинет даты.

Запуск (из папки backend, внутри контейнера):
    python scripts/backfill_achievements.py
    python scripts/backfill_achievements.py --посчитать   # только показать
"""

import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import achievements  # noqa: E402
from services.session import SessionStore  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")


async def начислить_пользователю(pool, user_id: str, имя: str, сухой: bool) -> int:
    """Прогоняет историю одного человека. Возвращает число выданных бейджей."""
    история = await pool.fetch(achievements._ИСТОРИЯ_SQL, user_id)
    if not история:
        return 0

    сводка = achievements.Сводка()
    всего = 0
    # Что уже лежит у человека. Нужно сухому прогону: `оценить` возвращает
    # всё, что выполняется СЕЙЧАС, а не только новое, и без этого множества
    # прогноз показывал бы «first-contact» на каждом разговоре подряд —
    # то есть расходился бы с тем, что запишет настоящий прогон
    уже = {
        строка["achievementId"]
        for строка in await pool.fetch(
            'SELECT "achievementId" FROM "UserAchievement" WHERE "userId" = $1',
            user_id,
        )
    }
    for строка in история:
        разговор = achievements._из_строки(строка)
        (
            разговор.реплики_менеджера,
            разговор.реплики_пациента,
        ) = await achievements._реплики(pool, строка["id"])

        новое = achievements.оценить(сводка, разговор) - уже
        if новое:
            когда = await pool.fetchval(
                'SELECT COALESCE("endedAt", "startedAt") FROM "Session" WHERE "id" = $1',
                строка["id"],
            )
            выданы = (
                sorted(новое)
                if сухой
                else await achievements.выдать(pool, user_id, новое, когда)
            )
            уже |= set(выданы)
            for слаг in выданы:
                print(f"  {имя}: {слаг} ({когда:%d.%m.%Y})")
            всего += len(выданы)

        сводка = achievements.продолжить(сводка, разговор)
    return всего


async def main() -> None:
    разбор = argparse.ArgumentParser(description=__doc__)
    разбор.add_argument(
        "--посчитать",
        action="store_true",
        help="ничего не писать, только показать, что было бы выдано",
    )
    доводы = разбор.parse_args()

    store = SessionStore()
    await store.connect()
    try:
        люди = await store.pool.fetch(
            'SELECT "id", "email", "firstName" FROM "User" ORDER BY "createdAt"'
        )
        print(f"=== Достижения задним числом ({len(люди)} пользователей) ===\n")
        всего = 0
        for человек in люди:
            всего += await начислить_пользователю(
                store.pool,
                человек["id"],
                человек["email"],
                доводы.посчитать,
            )
        глагол = "было бы выдано" if доводы.посчитать else "выдано"
        print(f"\nВсего {глагол}: {всего}")
        if доводы.посчитать:
            print("Ничего не записано — это сухой прогон.")
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(main())
