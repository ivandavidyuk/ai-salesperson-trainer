"""Прогон пресетных случаев через критика — того же, что судит генерацию в бою.

Пресеты написаны руками и лежат в репозитории фронтенда. Значит они прошли
мимо генератора, а вместе с ним — мимо `case_review`: единственной проверки,
которая читает случай как специалист, а не как валидатор формы. Рукописный
текст ошибается там же, где ошибалась модель: возрастное состояние
у молодого, жалобы поздней стадии при ранней, услуга не от того диагноза.

Критик здесь ровно тот же и с теми же вопросами — меняется только источник
случаев: не свежая генерация, а файл.

    cd frontend && npm run --silent dump:presets > пресеты.json
    docker cp пресеты.json ai-trainer-backend-1:/tmp/
    docker exec ai-trainer-backend-1 sh -c \\
        'cd /app && python scripts/review_presets.py --файл /tmp/пресеты.json'

ПЛАТНО, но дёшево: один вызов дешёвой модели на случай (критик считает
токены десятками, а не тысячами). Полная сверка двух отраслей — 42 вызова.

Вердикт печатается по каждому случаю, в конце — сводка и расход. Скрипт
ничего не чинит и никуда не пишет: правки идут в репозиторий руками.
"""

import argparse
import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import get_settings  # noqa: E402
from services import case_review, usage  # noqa: E402

# Провайдер троттлит, если бить вплотную — та же пауза, что при сборке
_ПАУЗА_СЕК = 1.0


async def прогнать(случаи: list[dict]) -> list[dict]:
    """Каждый случай — критику. Возвращает строки отчёта."""
    итог: list[dict] = []

    for номер, строка in enumerate(случаи, 1):
        годится, виновник, возражение = await case_review.review(
            строка["personality"],
            строка["picture"],
            строка["case"],
            строка.get("service", ""),
        )
        итог.append(
            {
                "отрасль": строка.get("industry", ""),
                "имя": строка.get("patientName", ""),
                "диагноз": строка["picture"].get("diagnosis", ""),
                "годится": годится,
                "виновник": виновник,
                "возражение": возражение,
            }
        )
        метка = "годится" if годится else f"БРАК ({виновник}): {возражение}"
        print(
            f"  {номер}/{len(случаи)} {строка.get('patientName', '')} "
            f"[{строка.get('industry', '')}] — {метка}",
            file=sys.stderr,
            flush=True,
        )
        await asyncio.sleep(_ПАУЗА_СЕК)
    return итог


async def main() -> None:
    разбор = argparse.ArgumentParser(description="Критик читает пресетные случаи")
    разбор.add_argument("--файл", required=True, help="JSON из npm run dump:presets")
    разбор.add_argument("--отрасль", default=None, help="только одна отрасль")
    разбор.add_argument("--модель", default=None,
                        help="модель критика; по умолчанию critic_model из настроек")
    доводы = разбор.parse_args()

    with open(доводы.файл, encoding="utf-8") as файл:
        случаи = json.load(файл)
    if доводы.отрасль:
        случаи = [с for с in случаи if с.get("industry") == доводы.отрасль]

    # Браковки критик пишет уровнем INFO — без этого прогон, где он вмешался
    # семь раз, выглядит молчаливым
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)

    настройки = get_settings()
    if доводы.модель:
        настройки.critic_model = доводы.модель
    # Критик выключается настройкой, и выключенный молча со всем соглашается.
    # Прогон, где он отключён, — это чистый отчёт ни о чём, и принять его
    # за проверенное качество проще всего
    if not настройки.critic_enabled:
        print(
            "CRITIC_ENABLED выключен — критик согласится со всем, не потратив "
            "ни вызова. Включите его, иначе отчёт ничего не значит.",
            file=sys.stderr,
        )
        sys.exit(2)

    print(
        f"Критик {настройки.critic_model}. Случаев {len(случаи)}. ПЛАТНО.",
        file=sys.stderr,
    )

    with usage.учёт() as счёт:
        строки = await прогнать(случаи)

    брак = [с for с in строки if not с["годится"]]
    print(
        f"\nГодятся {len(строки) - len(брак)} из {len(строки)}.",
        file=sys.stderr,
    )
    for с in брак:
        print(
            f"  БРАК · {с['отрасль']} · {с['имя']} · {с['диагноз']} "
            f"· виновата {с['виновник']}: {с['возражение']}",
            file=sys.stderr,
        )

    print(json.dumps({"случаи": строки, "расход": счёт.как_словарь()},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
