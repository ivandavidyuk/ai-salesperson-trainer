"""Замер итогового оценщика: даёт ли он одной работе одну оценку и верную ли.

Повод — 24.09: повторный прогон по тем же правилам дал тем же разговорам
другие оценки (общая 9,0 → 6,6, 7,8 → 5,8), за прогон менялись 5–10
отметок из 25. Разбор видят менеджер и клиент, поэтому модель и способ
выбираются замером, а не на глаз.

Два режима:

    # в контейнере backend на DE — только гоняет оценщик, в базу не пишет
    python scripts/measure_scorer.py прогон \\
        --конфиг google/gemini-3.5-flash-lite@0.2 --конфиг google/gemini-3.5-flash-lite@0 \\
        --прогонов 5 > прогоны.json

    # где угодно — сводит прогоны с эталоном (scripts/scorer_labelled.json)
    python scripts/measure_scorer.py отчёт прогоны.json

Конфигурация — «модель@температура[@усилие]»; усилие размышления — как
в ask_json (medium по умолчанию, как в бою; none — не думать). Разговоры
по умолчанию — шесть из эталона; их id зашиты ниже, чтобы прогону не нужен
был файл эталона.

ПЛАТНО: разговоров × прогонов вызовов на конфигурацию, плюс повторы, когда
у оценщика не сошлись номера реплик. Цена в отчёте — по токенам и прайсу
ниже: счётчик OpenRouter отстаёт на минуты и сразу после пачки показывает
ноль (проверено 24.09). Общий счётчик снимать до пачки и через пару минут
после.

ЧТО СЧИТАЕТ ОТЧЁТ
- разброс: размах общей и каждого этапа за прогоны; доля прогонов, где
  пункт совпал со своим самым частым значением; одинаков ли исход;
- верность: совпадение пунктов с эталоном; отклонение общей от эталонной;
- сбросы сверки — отметки, обнулённые из-за номера реплики, отдельно
  от того, что модель передумала;
- «медиана трёх»: из пяти прогонов, по всем тройкам. Тройки делят прогоны,
  поэтому её разброс занижен — это прикидка, не замер.
"""

import argparse
import asyncio
import contextvars
import functools
import itertools
import json
import os
import statistics
import sys
import time
from collections import Counter

# Прогон подаётся в боевой контейнер через stdin (`docker exec -i … python -`),
# чтобы не класть файлы в контейнер, — там у скрипта нет __file__
_ЗДЕСЬ = (
    os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else "/app/scripts"
)
sys.path.insert(0, os.path.dirname(_ЗДЕСЬ))

_ЭТАЛОН = os.path.join(_ЗДЕСЬ, "scorer_labelled.json")
_РАЗГОВОРЫ = ["e3933ace", "8f80b017", "78b5617f", "1dd22db2", "ea0628ef", "6b38554d"]
_ЭТАПЫ = [("contact", 1, 5), ("iceBreaker", 6, 10), ("needs", 11, 15),
          ("objections", 16, 20), ("closing", 21, 25)]
_ПАРАЛЛЕЛЬНО = 4
# Цены OpenRouter на 24.09, $ за миллион токенов: вход, выход. Размышление
# тарифицируется как выход и уже входит в completion_tokens
_ЦЕНЫ = {
    "google/gemini-3.5-flash-lite": (0.30, 2.50),
    "google/gemini-3.5-flash": (1.50, 9.00),
    "openai/gpt-5.6-luna": (0.20, 1.20),
    "anthropic/claude-haiku-4.5": (1.00, 5.00),
    "anthropic/claude-sonnet-5": (2.00, 10.00),
}


# --- Прогон -------------------------------------------------------------------

async def _расход() -> float:
    """Счётчик OpenRouter, доллары. Ключ не печатается."""
    import httpx
    from core.config import get_settings

    s = get_settings()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{s.llm_base_url}/auth/key",
            headers={"Authorization": f"Bearer {s.llm_api_key}"},
        )
        return float(r.json()["data"]["usage"])


async def прогон(
    конфиги: list[str], прогонов: int, разговоры: list[str], параллельно: int = _ПАРАЛЛЕЛЬНО
) -> dict:
    from core.config import get_settings
    from services import scoring, usage
    from services.session import SessionStore

    store = SessionStore()
    await store.connect()
    данные = []
    for short in разговоры:
        sid = await store.pool.fetchval('SELECT id FROM "Session" WHERE id LIKE $1', short + "%")
        данные.append((short, await store.get_transcript(sid), await store.get_review_context(sid)))

    # Сверка отметок с репликами: запоминаем каждую попытку оценщика —
    # сколько отметок модель поставила и сколько обнулила сверка
    попытки: contextvars.ContextVar[list] = contextvars.ContextVar("попытки")
    исходная_сверка = scoring._ground_final

    def сверка(result, history):
        grounded = исходная_сверка(result, history)
        попытки.get().append({
            "raw": result.get("marks"),
            "dropped": grounded.dropped,
            "positive": grounded.positive,
        })
        return grounded

    scoring._ground_final = сверка
    исходный_ask = scoring.ask_json
    настройки = get_settings()
    итог = {"configs": []}

    for конфиг in конфиги:
        модель, температура, усилие = (конфиг.split("@") + ["", ""])[:3]
        настройки.final_scorer_model = модель
        scoring.ask_json = functools.partial(
            исходный_ask,
            temperature=float(температура or 0.2),
            reasoning=None if усилие == "none" else (усилие or "medium"),
        )
        до = await _расход()
        начало = time.monotonic()
        семафор = asyncio.Semaphore(параллельно)

        async def один(short, history, ctx, номер):
            async with семафор:
                попытки.set([])
                t0 = time.monotonic()
                review = await scoring.review_conversation(
                    history, ctx["patient_prompt"], rubric=ctx["rubric"],
                    done_when=ctx["done_when"], scores_deal=ctx["scores_deal"],
                    stage_key=ctx["stage_key"], type_id=ctx["type_id"],
                    industry=ctx["industry"],
                )
                секунд = round(time.monotonic() - t0, 1)
                все = попытки.get()
                # review_conversation берёт попытку с наименьшими потерями
                выбрана = min(все, key=lambda p: p["dropped"]) if все else None
                if review is None:
                    return {"short": short, "run": номер, "failed": True, "seconds": секунд}
                return {
                    "short": short, "run": номер, "seconds": секунд,
                    "outcome": review.outcome, "overall": review.overall,
                    "stages": {**review.stages.as_dict(), "closing": review.closing},
                    "marks": {str(it["n"]): it.get("mark") for st in review.checklist
                              for it in st.get("items", [])},
                    "msgs": {str(it["n"]): it.get("msg") for st in review.checklist
                             for it in st.get("items", [])},
                    "measured": {st["stage"]: st.get("measured") for st in review.checklist},
                    "raw": выбрана["raw"] if выбрана else None,
                    "dropped": выбрана["dropped"] if выбрана else None,
                    "attempts": len(все),
                }

        with usage.учёт() as счёт:
            прогоны = await asyncio.gather(*[
                один(short, h, ctx, n)
                for short, h, ctx in данные for n in range(1, прогонов + 1)
            ])
        итог["configs"].append({
            "config": конфиг, "model": модель, "temperature": float(температура or 0.2),
            "effort": усилие or "medium",
            "cost_usd": round(await _расход() - до, 4),
            "seconds": round(time.monotonic() - начало, 1),
            "tokens": счёт.как_словарь(),
            "runs": прогоны,
        })
        # Каждая конфигурация — строкой сразу, как готова. 24.09 прогон
        # остановили на четвёртой из-за перерасхода, а ответы печатались
        # только в конце — три готовые конфигурации ($2,5) пропали целиком
        print(json.dumps(итог["configs"][-1], ensure_ascii=False), flush=True)
        print(f"{конфиг}: готово, ${итог['configs'][-1]['cost_usd']}", file=sys.stderr)

    scoring._ground_final = исходная_сверка
    scoring.ask_json = исходный_ask
    await store.close()
    return итог


# --- Отчёт --------------------------------------------------------------------

def _этапы(marks: dict) -> dict:
    """Оценки этапов из отметок: сумма пяти, None — этап не измерен."""
    out = {}
    for name, a, b in _ЭТАПЫ:
        vals = [marks.get(str(n)) for n in range(a, b + 1)]
        out[name] = None if all(v is None for v in vals) else float(sum(v or 0 for v in vals))
    return out


def _общая(stages: dict) -> float:
    measured = [v for v in stages.values() if v is not None]
    return round(sum(measured) / len(measured), 1) if measured else 0.0


def _медиана(values: list):
    values = [v for v in values if v is not None]
    return int(statistics.median_low(values)) if values else None


def отчёт(путь: str) -> str:
    # Прогон пишет по строке на конфигурацию; первые замеры 24.09 — одним JSON
    with open(путь, encoding="utf-8") as f:
        текст = f.read().strip()
    if текст.startswith('{"configs"'):
        прогоны = json.loads(текст)
    else:
        прогоны = {"configs": [json.loads(s) for s in текст.splitlines() if s.strip()]}
    with open(_ЭТАЛОН, encoding="utf-8") as f:
        эталон = {c["short"]: c for c in json.load(f)["cases"]}

    строки = []
    for cfg in прогоны["configs"]:
        runs = [r for r in cfg["runs"] if not r.get("failed")]
        сбоев = len(cfg["runs"]) - len(runs)
        n_runs = len(runs)
        строки.append(f"\n## {cfg['config']}\n")
        токены = cfg.get("tokens", {}).get("по_моделям", {}).get(cfg["model"], {})
        вход, выход = _ЦЕНЫ.get(cfg["model"], (0.0, 0.0))
        цена = (токены.get("вход", 0) * вход + токены.get("выход", 0) * выход) / 1e6
        вызовов = max(1, токены.get("вызовов", 0))
        строки.append(
            f"≈${цена:.3f} по токенам за {len(cfg['runs'])} разборов "
            f"({токены.get('вызовов', 0)} вызовов, ≈${цена / max(1, len(cfg['runs'])):.4f} за разбор); "
            f"на вызов в среднем {токены.get('вход', 0) // вызовов} на входе, "
            f"{токены.get('выход', 0) // вызовов} на выходе, из них размышление "
            f"{токены.get('размышление', 0) // вызовов}; {cfg['seconds']} с на пачку, "
            f"без ответа: {сбоев}\n"
        )
        строки.append("| Разговор | эталон | общая по прогонам | размах | этапы: размах | исход | пункт = своей моде | = эталону | п.5 | сброшено |")
        строки.append("|---|---|---|---|---|---|---|---|---|---|")
        сводка = {"размах": [], "мода": [], "эталон": [], "исход_один": True, "п5": [], "откл": []}
        for short, этал in эталон.items():
            мои = [r for r in runs if r["short"] == short]
            if not мои:
                continue
            ref_marks = {str(i["n"]): i["mark"] for i in этал["items"]}
            ref_overall = _общая(_этапы(ref_marks))
            общие = [r["overall"] for r in мои]
            размах = round(max(общие) - min(общие), 1)
            этапы_размах = []
            for name, _, _ in _ЭТАПЫ:
                vals = [r["stages"].get(name) for r in мои if r["stages"].get(name) is not None]
                этапы_размах.append(f"{max(vals) - min(vals):.0f}" if vals else "—")
            исходы = Counter(r["outcome"] for r in мои)
            совпало_с_модой, всего, совпало_с_эталоном, всего_эт = 0, 0, 0, 0
            for n in range(1, 26):
                k = str(n)
                vals = [r["marks"].get(k) for r in мои]
                мода, сколько = Counter(vals).most_common(1)[0]
                совпало_с_модой += сколько
                всего += len(vals)
                if ref_marks.get(k) is not None:
                    совпало_с_эталоном += sum(1 for v in vals if v == ref_marks[k])
                    всего_эт += len(vals)
            п5 = [r["marks"].get("5") for r in мои]
            сброшено = [r.get("dropped") or 0 for r in мои]
            доля_мода = совпало_с_модой / всего
            доля_эт = совпало_с_эталоном / всего_эт if всего_эт else 0
            сводка["размах"].append(размах)
            сводка["мода"].append(доля_мода)
            сводка["эталон"].append(доля_эт)
            сводка["исход_один"] &= len(исходы) == 1
            сводка["п5"] += п5
            сводка["откл"] += [abs(o - ref_overall) for o in общие]
            строки.append(
                f"| {short} | {ref_overall} | {' / '.join(str(o) for o in общие)} | {размах} | "
                f"{' '.join(этапы_размах)} | {', '.join(f'{k}×{v}' for k, v in исходы.items())} "
                f"(эталон {этал['outcome']}) | {доля_мода:.0%} | {доля_эт:.0%} | "
                f"{''.join(str(v) for v in п5)} | {sum(сброшено)} |"
            )
        if сводка["размах"]:
            годится = (
                max(сводка["размах"]) <= 0.5
                and min(сводка["мода"]) >= 0.9
                and сводка["исход_один"]
                and all(v == 2 for v in сводка["п5"])
            )
            строки.append(
                f"\n**Итог:** размах общей до {max(сводка['размах'])}, "
                f"пункт = своей моде {min(сводка['мода']):.0%}–{max(сводка['мода']):.0%}, "
                f"= эталону в среднем {statistics.mean(сводка['эталон']):.0%}, "
                f"отклонение общей от эталона в среднем {statistics.mean(сводка['откл']):.2f}, "
                f"исход {'одинаков везде' if сводка['исход_один'] else 'гуляет'}, "
                f"п.5 = 2 в {sum(1 for v in сводка['п5'] if v == 2)} из {len(сводка['п5'])}. "
                f"Критерий плана (без сравнения с эталоном): {'выполнен' if годится else 'не выполнен'}."
            )
            строки.append(_медиана_трёх(runs, эталон))
    return "\n".join(строки)


def _медиана_трёх(runs: list, эталон: dict) -> str:
    """Прикидка «три прогона + медиана по пункту» из уже сделанных прогонов."""
    размахи, точности = [], []
    for short, этал in эталон.items():
        мои = [r for r in runs if r["short"] == short]
        if len(мои) < 3:
            continue
        ref_marks = {str(i["n"]): i["mark"] for i in этал["items"]}
        общие = []
        for тройка in itertools.combinations(мои, 3):
            marks = {str(n): _медиана([r["marks"].get(str(n)) for r in тройка]) for n in range(1, 26)}
            общие.append(_общая(_этапы(marks)))
            есть = [k for k, v in ref_marks.items() if v is not None]
            точности.append(sum(1 for k in есть if marks.get(k) == ref_marks[k]) / len(есть))
        размахи.append(round(max(общие) - min(общие), 1))
    if not размахи:
        return ""
    return (
        f"Медиана трёх (прикидка по тройкам из этих прогонов): размах общей до "
        f"{max(размахи)}, = эталону в среднем {statistics.mean(точности):.0%}."
    )


def main() -> None:
    разбор = argparse.ArgumentParser(description="Замер итогового оценщика")
    режимы = разбор.add_subparsers(dest="режим", required=True)
    п = режимы.add_parser("прогон")
    п.add_argument("--конфиг", action="append", required=True, help="модель@температура")
    п.add_argument("--прогонов", type=int, default=5)
    п.add_argument("--разговоры", default=",".join(_РАЗГОВОРЫ))
    # Когда меряется время разбора — по одному: в бою разбор идёт один,
    # а параллельные вызовы делят лимиты провайдера и время завышают
    п.add_argument("--параллельно", type=int, default=_ПАРАЛЛЕЛЬНО)
    о = режимы.add_parser("отчёт")
    о.add_argument("файл")
    аргументы = разбор.parse_args()

    if аргументы.режим == "прогон":
        # Конфигурации печатаются по мере готовности внутри прогона
        asyncio.run(прогон(аргументы.конфиг, аргументы.прогонов,
                           аргументы.разговоры.split(","), аргументы.параллельно))
    else:
        print(отчёт(аргументы.файл))


if __name__ == "__main__":
    main()
