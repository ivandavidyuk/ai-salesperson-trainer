"""Точка входа: матрица пациентов и типов, параллельность, возобновление.

    python -m qa.run --all
    python -m qa.run --patients oksana-kuznetsova --types s4
    python -m qa.run --failed-from qa-runs/2026-08-04T12-00
    python -m qa.report ...            # сводка и сравнение

Без аргументов НИЧЕГО не запускает: печатает, что мог бы прогнать, во сколько
это обойдётся и сколько займёт. «Прогони всё» не должно случаться по
недоразумению — полная матрица это полтора часа и живые деньги.

Запускать внутри backend-контейнера на DE: потолок первого токена 2 с из
России ложно срабатывает, и половина прогона уходит к резерву — замер
превращается в замер сетевой задержки.
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import get_settings  # noqa: E402
from services import usage  # noqa: E402

from qa import checks, conversation, reader, report, store  # noqa: E402

КАТАЛОГ_ПРОГОНОВ = Path("qa-runs")
СЦЕНАРИИ = Path(__file__).resolve().parent.parent / "scripts" / "dialogues"

# Ловушки: сценарии, где менеджер делает ровно одну запрещённую вещь.
# Без них критерии оказывались декоративными — четыре из шести молча
# пропускали брак, и обнаружилось это только когда ловушки появились
ЛОВУШКИ = {
    "s1": ["s1-contact-no-compliment"],
    "s3": ["s3-needs-price-trap"],
    "s4": ["s4-objections-empty"],
    "s2": ["s2-icebreak-anketa"],
    "intercept": ["intercept-only-answers"],
}

# Грубая прикидка стоимости по нашим замерам: разговор в 11–20 ходов даёт
# около 23 обращений, в каждом промпт ~2000 токенов. Цена нужна не точная,
# а такая, чтобы «прогони всё» не оказалось сюрпризом
_ТОКЕНОВ_НА_КЛЕТКУ = 46_000
_ЦЕНА_ЗА_МИЛЛИОН = 0.35
_СЕКУНД_НА_КЛЕТКУ = 170


def _читать_сценарий(имя: str) -> Optional[list[str]]:
    """Реплики менеджера из файла сценария; None — файла нет."""
    файл = СЦЕНАРИИ / f"{имя}.txt"
    if not файл.exists():
        return None
    сырое = файл.read_text(encoding="utf-8").replace("\r\n", "\n")
    блоки = []
    for блок in сырое.split("\n\n"):
        текст = " ".join(
            строка.strip()
            for строка in блок.strip().split("\n")
            if строка.strip() and not строка.startswith("#")
        )
        if текст:
            блоки.append(текст)
    return блоки or None


def _git() -> str:
    """Каким кодом получен прогон.

    В контейнере git не установлен и репозитория нет, поэтому сперва смотрим
    переменную окружения: её проставляет деплой или тот, кто запускает прогон
    руками. Без этой отметки через неделю не понять, что именно мерилось.
    """
    из_окружения = os.environ.get("QA_GIT_SHA")
    if из_окружения:
        return из_окружения.strip()
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:  # noqa: BLE001
        return "неизвестно"


def _клетки(
    пациенты: list[store.Пациент],
    типы: list[store.ТипТренировки],
    args: argparse.Namespace,
) -> list[tuple[store.Пациент, store.ТипТренировки, Optional[str]]]:
    """Что именно прогонять: пациент, тип и имя сценария-ловушки, если это она."""
    по_слагу = {п.слаг: п for п in пациенты}
    типы_по_слагу = {т.слаг: т for т in типы}

    if args.failed_from:
        каталог = report.прочитать_каталог(args.failed_from)
        пары = report.помеченные(каталог)
        return [
            (по_слагу[p], типы_по_слагу[t], None)
            for p, t in пары
            if p in по_слагу and t in типы_по_слагу
        ]

    выбранные_пациенты = (
        [по_слагу[с] for с in args.patients.split(",") if с in по_слагу]
        if args.patients
        else пациенты
    )
    выбранные_типы = (
        [типы_по_слагу[с] for с in args.types.split(",") if с in типы_по_слагу]
        if args.types
        else типы
    )

    клетки = []
    if args.traps:
        # Ловушки идут отдельным набором: они проверяют не пациента, а то,
        # что критерий вообще срабатывает
        for тип in выбранные_типы:
            for имя in ЛОВУШКИ.get(тип.слаг, []):
                for пациент in выбранные_пациенты:
                    клетки.append((пациент, тип, имя))
        return клетки

    for пациент in выбранные_пациенты:
        for тип in выбранные_типы:
            клетки.append((пациент, тип, None))
    return клетки


async def _одна(
    пациент: store.Пациент,
    тип: store.ТипТренировки,
    ловушка: Optional[str],
    каталог: Path,
    args: argparse.Namespace,
    семафор: asyncio.Semaphore,
    прогресс: dict,
    клиника: Optional[store.Клиника],
) -> None:
    имя_файла = f"{пациент.слаг}__{тип.слаг}"
    if ловушка:
        имя_файла += f"__{ловушка}"
    файл = (каталог / "results" / f"{имя_файла}.json")

    if args.resume and файл.exists():
        прогресс["готово"] += 1
        return

    async with семафор:
        # Полный разговор ведётся по сценарию пациента: он детерминирован
        # и сравним между прогонами. Этапами разговор ведёт пациент, и там
        # заготовленные реплики промахиваются мимо заданного вопроса
        имя_сценария = ловушка or (пациент.слаг if тип.считает_сделку else None)
        реплики = _читать_сценарий(имя_сценария) if имя_сценария else None

        # Учёт токенов на клетку: без него расход виден только общей суммой
        # у провайдера, и понять, на что именно ушло, нельзя
        with usage.учёт() as счёт:
            разговор = await conversation.провести(
                пациент,
                тип,
                реплики=реплики,
                сценарий=имя_сценария,
                клиника=клиника,
            )
            метрики = checks.посчитать(разговор.история(), пациент.промпт)

            чтение = None
            if not args.no_reader and разговор.ходы:
                чтение = await reader.прочитать(
                    разговор.история(), пациент.промпт, модель=args.reader_model
                )

        файл.write_text(
            json.dumps(
                {
                    "разговор": разговор.as_dict(),
                    "метрики": метрики.as_dict(),
                    "чтение": чтение.as_dict() if чтение else None,
                    "расход": счёт.как_словарь(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    прогресс["готово"] += 1
    # По ходу прогона медианы ещё нет — многословность посчитается в сводке,
    # когда будут все клетки. Здесь показываем то, что видно сразу
    поводы = report.поводы_посмотреть(
        {"разговор": разговор.as_dict(), "метрики": метрики.as_dict(),
         "чтение": чтение.as_dict() if чтение else None}
    )
    метка = f"  ⚠ {', '.join(поводы)}" if поводы else ""
    print(
        f"[{прогресс['готово']:3d}/{прогресс['всего']}] {имя_файла} "
        f"· {разговор.длительность_с} с{метка}",
        flush=True,
    )
    (каталог / "progress.json").write_text(
        json.dumps(прогресс, ensure_ascii=False), encoding="utf-8"
    )


async def дочитать(args: argparse.Namespace) -> None:
    """Второй круг: модель дочитывает клетки, помеченные механикой.

    Прогон разговоров и чтение разведены намеренно. Механика дешёвая и
    считается по всем 147 клеткам; читатель дорогой — 04.08 он оказался
    самой затратной частью прогона, — и звать его на каждую клетку незачем.
    Пусть арифметика отбирает, а модель дочитывает отобранное.
    """
    каталог = report.прочитать_каталог(args.reread)
    результаты = report.загрузить_прогон(каталог)
    медиана = report.медиана_прогона(результаты)

    к_чтению = []
    for результат in результаты:
        уже = результат.get("чтение")
        if уже and not уже.get("ошибка"):
            continue  # эту клетку уже читали
        if report.поводы_посмотреть(результат, медиана):
            к_чтению.append(результат)

    print(f"клеток в прогоне: {len(результаты)} · к дочитыванию: {len(к_чтению)}")
    if not к_чтению:
        print("Читать нечего: помеченных клеток нет или все уже прочитаны.")
        return

    пациенты, _, _, _ = await store.загрузить(args.organization)
    промпты = {п.слаг: п.промпт for п in пациенты}
    семафор = asyncio.Semaphore(args.concurrency)

    async def один(результат: dict) -> None:
        разговор = результат["разговор"]
        промпт = промпты.get(разговор["пациент"])
        if not промпт:
            print(f"  {разговор['пациент']}: промпта нет, пропускаю")
            return
        история = []
        for ход in разговор["ходы"]:
            история.append({"role": "user", "text": ход["менеджер"]})
            история.append({"role": "assistant", "text": ход["пациент"]})

        async with семафор:
            with usage.учёт() as счёт:
                чтение = await reader.прочитать(
                    история, промпт, модель=args.reader_model
                )
        результат["чтение"] = чтение.as_dict()
        # Расход второго круга складываем к расходу первого: иначе строка
        # «сколько стоила клетка» окажется неполной
        прежний = (результат.get("расход") or {}).get("по_моделям") or {}
        новый = счёт.как_словарь()
        for имя, значения in прежний.items():
            если_есть = новый["по_моделям"].setdefault(имя, значения)
            if если_есть is not значения:
                for ключ, число in значения.items():
                    если_есть[ключ] += число
        новый["всего_токенов"] = sum(
            м["вход"] + м["выход"] for м in новый["по_моделям"].values()
        )
        результат["расход"] = новый

        имя_файла = f"{разговор['пациент']}__{разговор['тип']}"
        if разговор.get("сценарий") and разговор["сценарий"] != разговор["пациент"]:
            имя_файла += f"__{разговор['сценарий']}"
        (каталог / "results" / f"{имя_файла}.json").write_text(
            json.dumps(результат, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        находок = len(чтение.находки)
        print(f"  {имя_файла}: находок {находок}", flush=True)

    await asyncio.gather(*(один(р) for р in к_чтению))
    (каталог / "summary.md").write_text(report.сводка(каталог), encoding="utf-8")
    print(f"\nсводка обновлена: {каталог / 'summary.md'}")


async def main() -> None:
    парсер = argparse.ArgumentParser(description="Проверка промптов пациентов")
    парсер.add_argument("--all", action="store_true", help="вся матрица")
    парсер.add_argument("--patients", help="слаги через запятую")
    парсер.add_argument("--types", help="слаги через запятую")
    парсер.add_argument("--failed-from", help="только помеченные клетки прогона")
    парсер.add_argument("--traps", action="store_true", help="только ловушки")
    парсер.add_argument("--resume", help="доделать прогон", metavar="ПРОГОН")
    парсер.add_argument("--repeat", type=int, default=1, help="повторов клетки")
    парсер.add_argument("--concurrency", type=int, default=5)
    парсер.add_argument("--reader-model", default=reader.МОДЕЛЬ_ПО_УМОЛЧАНИЮ)
    парсер.add_argument("--no-reader", action="store_true", help="без чтения моделью")
    парсер.add_argument("--organization", help="id организации для случаев")
    парсер.add_argument(
        "--reread",
        metavar="ПРОГОН",
        help="не гонять разговоры, а дочитать моделью помеченные клетки прогона",
    )
    args = парсер.parse_args()

    if args.reread:
        await дочитать(args)
        return

    пациенты, типы, клиника, замечания = await store.загрузить(args.organization)
    for з in замечания:
        print(f"замечание: {з}", flush=True)

    клетки = _клетки(пациенты, типы, args)
    if args.repeat > 1:
        клетки = [к for к in клетки for _ in range(args.repeat)]

    минут = len(клетки) * _СЕКУНД_НА_КЛЕТКУ / max(args.concurrency, 1) / 60
    цена = len(клетки) * _ТОКЕНОВ_НА_КЛЕТКУ / 1_000_000 * _ЦЕНА_ЗА_МИЛЛИОН
    print(
        f"\nпациентов: {len(пациенты)} · типов: {len(типы)} · "
        f"клеток к прогону: {len(клетки)}"
    )
    print(f"примерно: {минут:.0f} мин при параллельности {args.concurrency}, "
          f"около ${цена:.2f}\n")

    выбор_сделан = any(
        [args.all, args.patients, args.types, args.failed_from, args.traps, args.resume]
    )
    if not выбор_сделан:
        # Ничего не запускаем без явного выбора: полная матрица это полтора
        # часа и живые деньги, и случиться она должна намеренно
        print("Ничего не запущено. Укажите --all или фильтры "
              "(--patients / --types / --failed-from / --traps).")
        return
    if not клетки:
        print("Под фильтры ничего не попало.")
        return

    каталог = (
        report.прочитать_каталог(args.resume)
        if args.resume
        else КАТАЛОГ_ПРОГОНОВ
        / datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    )
    (каталог / "results").mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    (каталог / "run.json").write_text(
        json.dumps(
            {
                "начат": datetime.now(timezone.utc).isoformat(),
                "git": _git(),
                "модель_роли": settings.llm_model,
                "модель_резерва": settings.fallback_model,
                "модель_итога": settings.final_scorer_model,
                "модель_читателя": None if args.no_reader else args.reader_model,
                "клеток": len(клетки),
                "параллельность": args.concurrency,
                "замечания": замечания,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    прогресс = {"всего": len(клетки), "готово": 0}
    семафор = asyncio.Semaphore(args.concurrency)
    начало = time.monotonic()

    await asyncio.gather(
        *(
            _одна(п, т, л, каталог, args, семафор, прогресс, клиника)
            for п, т, л in клетки
        )
    )

    (каталог / "summary.md").write_text(report.сводка(каталог), encoding="utf-8")
    print(
        f"\nготово за {(time.monotonic() - начало) / 60:.0f} мин · "
        f"сводка: {каталог / 'summary.md'}"
    )


if __name__ == "__main__":
    asyncio.run(main())
