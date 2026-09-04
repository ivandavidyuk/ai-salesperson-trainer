"""Чек-лист оценки: 25 фиксированных действий по пяти этапам сделки.

Оценка этапа — не впечатление, а сумма отметок по пяти действиям:
0 — не выполнено, 1 — частично, 2 — выполнено. Десятка достижима —
все пять сделаны полностью, — и разбор сам отвечает менеджеру «чего
не хватило»: пунктами, где стоит не «выполнено».

Почему так, а не шкалой «7–8 профессионально, 9–10 образцово»: за 92
разговора на прежней шкале максимум был 8,3, девяток не было вовсе —
у впечатления нет верха, а у списка сделанного есть.

Список один на все разговоры, всех пациентов и обе отрасли: оценки
складываются в недельный «Прогресс» и статистику отдела и сопоставимы
только при одной рубрике. Утверждён врачом 04.09.2026; формулировки взяты
из рубрик этапных тренировок, где они уже обкатаны. В разбор кладётся
СНИМОК названий и подсказок — правка списка не меняет старые разборы.

Числа считает код, не модель: модель ставит отметки и указывает номера
реплик, по которым их поставила.
"""

import re
from dataclasses import dataclass
from typing import Optional, Sequence

# Этапы в порядке прохождения. Первые четыре совпадают со STAGE_KEYS
# в scoring.py и полосами «Прогресса»; закрытие оценивается только итогом
STAGE_KEYS_ALL = ("contact", "iceBreaker", "needs", "objections", "closing")

STAGE_TITLES = {
    "contact": "Установка контакта",
    "iceBreaker": "«Топка льда»",
    "needs": "Выявление потребности",
    "objections": "Отработка возражений",
    "closing": "Закрытие сделки",
}

MARK_WORDS = {0: "не выполнено", 1: "частично", 2: "выполнено"}

ITEMS_PER_STAGE = 5


@dataclass(frozen=True)
class Item:
    n: int
    name: str
    # Что значит «выполнено» — одна строка. Она же показывается менеджеру
    # у пунктов с 0 и 1 как подсказка «Полностью: …»
    full: str


CHECKLIST: dict[str, tuple[Item, ...]] = {
    "contact": (
        Item(1, "Поздоровался и представился", "тепло, с именем и ролью, не на бегу"),
        Item(
            2,
            "Разговор по дороге",
            "дружеские вопросы (как добрались, самочувствие, погода) и отозвался на ответ",
        ),
        Item(3, "Комплимент", "про человека и вовремя, не шаблонный"),
        Item(
            4,
            "Взял встречу под контроль",
            "сказал, что будет происходить, и направил действия: куда сесть, "
            "куда вещи, как вести себя на приёме",
        ),
        Item(5, "Повторное знакомство", "спросил, как удобно обращаться, и представился сам"),
    ),
    "iceBreaker": (
        Item(6, "Спросил о человеке, а не о симптоме", "о работе, семье, увлечении, не анкетой"),
        Item(7, "Раскопал конкретную живую деталь", "пациент назвал её сам, своими словами"),
        Item(8, "Не бросил деталь, вернулся к ней", "следующая реплика о ней же"),
        Item(9, "Дал что-то своё в ответ", "своя история или совпадение, а не похвала"),
        Item(10, "Разговор на этом продолжился", "пациент ответил живой репликой, не «да/нет»"),
    ),
    "needs": (
        Item(11, "Задал открытый вопрос о жалобе", "на него нельзя ответить «да» или «нет»"),
        Item(12, "Спросил, как это мешает в жизни", "что перестал делать, чего избегает"),
        Item(
            13,
            "Услышал страх, а не только симптом",
            "пациент сам назвал, чего боится, менеджер это отразил",
        ),
        Item(14, "Проверил, что понял правильно", "пересказал своими словами и получил «да»"),
        Item(
            15,
            "Не назвал цену и не предложил решение раньше времени",
            "деньги отложил, к потребности вернулся",
        ),
    ),
    "objections": (
        Item(16, "Дал возражению прозвучать целиком", "не перебил, не ответил на полуслове"),
        Item(
            17,
            "Присоединился к возражению",
            "признал, что сомнение понятно, прежде чем отвечать",
        ),
        Item(18, "Аргументировал", "фактом, цифрой или сроком, а не уговором"),
        Item(
            19,
            "Побудил к действию",
            "после аргумента предложил следующий шаг, а не замолчал",
        ),
        Item(20, "Не спорил и не давил", "без «вы не правы» и без нажима"),
    ),
    "closing": (
        Item(21, "Назвал итог целиком", "что, когда, сколько — одной репликой, без «от»"),
        Item(
            22,
            "Не торопил, пока сомнения не сняты",
            "предложил только после ответа на последний страх",
        ),
        Item(23, "Попросил о решении прямо", "вопрос, на который надо ответить «да» или «нет»"),
        Item(24, "Предложил конкретный следующий шаг", "дата, время и способ оплаты названы"),
        Item(
            25,
            "Закрепил договорённость без нажима",
            "повторил вслух, что решили; при отказе не дожимал",
        ),
    ),
}


# --- Арифметика --------------------------------------------------------------


def clamp_mark(value: object) -> int:
    """Приводит отметку к 0/1/2. Мусор от модели — ноль, а не падение."""
    try:
        number = int(round(float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return max(0, min(2, number))


def stage_score(marks: Optional[Sequence[object]]) -> Optional[float]:
    """Оценка этапа — сумма пяти отметок, 0–10. None — этап не измерен.

    Список короче пяти дополняется нулями, длиннее — обрезается: пунктов
    ровно пять, и лишнее от модели не должно поднимать оценку.
    """
    if marks is None:
        return None
    values = [clamp_mark(m) for m in list(marks)[:ITEMS_PER_STAGE]]
    values += [0] * (ITEMS_PER_STAGE - len(values))
    return float(sum(values))


def overall(scores: dict[str, Optional[float]]) -> float:
    """Общая оценка — среднее измеренных этапов, с одним знаком.

    Не измеренный этап (None) в среднее не входит: возражений в разговоре
    могло не быть, и ноль за них соврал бы. Если не измерен ни один — 0.0.
    """
    measured = [v for v in scores.values() if v is not None]
    if not measured:
        return 0.0
    return round(sum(measured) / len(measured), 1)


def marks_by_stage(
    raw: Optional[dict],
    stage_keys: Sequence[str],
    *,
    unmeasured: Sequence[str] = (),
) -> dict[str, Optional[list[int]]]:
    """Отметки из ответа модели по этапам: ровно пять на этап, 0/1/2.

    Этап, которого в ответе нет, — нули: модель промолчала, значит действий
    не увидела. Этап из `unmeasured` — None, что бы модель ни прислала:
    «не измерен» решает код по факту (пациент не возражал), а не модель.
    """
    raw = raw if isinstance(raw, dict) else {}
    result: dict[str, Optional[list[int]]] = {}
    for key in stage_keys:
        if key in unmeasured:
            result[key] = None
            continue
        values = raw.get(key)
        if not isinstance(values, (list, tuple)):
            values = []
        marks = [clamp_mark(v) for v in list(values)[:ITEMS_PER_STAGE]]
        marks += [0] * (ITEMS_PER_STAGE - len(marks))
        result[key] = marks
    return result


# --- Цитаты ------------------------------------------------------------------

_NON_WORD = re.compile(r"[^0-9a-zа-яё]+")
# Короче этого нормализованная цитата не проверяется: «да» найдётся где угодно
_MIN_QUOTE_CHARS = 8


def normalize(text: str) -> str:
    """Регистр, ё/е и пунктуация не должны мешать сверке цитаты с репликой."""
    lowered = str(text).lower().replace("ё", "е")
    return " ".join(_NON_WORD.sub(" ", lowered).split())


def verify_quote(quote: object, history: Sequence[dict]) -> Optional[int]:
    """Индекс реплики менеджера, в которой встречается цитата, либо None.

    Модель просят цитировать дословно, но она пересказывает и иногда
    выдумывает. Выдуманная цитата хуже отсутствующей: менеджер ищет её
    в расшифровке и не находит — и перестаёт верить разбору целиком.
    Поэтому цитата без реплики отбрасывается, отметка остаётся.
    """
    if not isinstance(quote, str):
        return None
    needle = normalize(quote)
    if len(needle) < _MIN_QUOTE_CHARS:
        return None
    for index, item in enumerate(history):
        if item.get("role") != "user":
            continue
        if needle in normalize(item.get("text", "")):
            return index
    return None


def format_numbered(history: Sequence[dict]) -> str:
    """Расшифровка с номерами реплик — для оценщиков, которым нужны доказательства.

    Номер — индекс в истории, тот же, что уходит в снимок как `msg`.
    Модель указывает его вместо цитаты: скопировать число она умеет
    надёжно, а дословную цитату из живой речи с «э-э-э» — нет: на длинных
    расшифровках отбрасывались все двадцать пять.
    """
    lines = []
    for index, item in enumerate(history):
        who = "Менеджер" if item.get("role") == "user" else "Пациент"
        lines.append(f"[{index}] {who}: {item.get('text', '')}")
    return "\n".join(lines)


def verify_evidence(value: object, history: Sequence[dict]) -> Optional[int]:
    """Индекс реплики менеджера по доказательству модели, либо None.

    Доказательство — номер реплики (число или строка с числом); цитата
    текстом принимается как запасной вариант. Номер за пределами истории —
    не доказательство.

    Номер реплики пациента сводится к реплике менеджера перед ней. Модель
    ссылается на пациента законно: «разговор на этом продолжился» или
    «дал возражению прозвучать» видны именно по его ответу. И та же поправка
    лечит счёт с единицы: в одном прогоне модель сдвинула все номера на один,
    и строгая сверка «только менеджер» сбросила 23 отметки из 25 — хороший
    разговор получил 0,0.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().isdigit()):
        index = int(value)
        if not 0 <= index < len(history):
            return None
        while index >= 0 and history[index].get("role") != "user":
            index -= 1
        return index if index >= 0 else None
    return verify_quote(value, history)


# --- Доказательства и снимок ----------------------------------------------------


def ground(
    marks: dict[str, Optional[list[int]]],
    evidence: Optional[dict],
    history: Sequence[dict],
    stage_keys: Sequence[str],
) -> tuple[dict[str, Optional[list[int]]], dict[str, list[Optional[int]]], int]:
    """Сверяет отметки с доказательствами: отметка без реплики не засчитывается.

    Оценка ставится по тому, что видно в расшифровке. Отметка 1 или 2,
    к которой модель не смогла указать реплику менеджера, не подтверждена —
    и становится нулём. Иначе на длинных разговорах оценщик щедр: ставил
    «выполнено» за представление, которого в расшифровке нет.

    Возвращает исправленные отметки, индексы реплик по пунктам и число
    сброшенных отметок — для лога, чтобы видеть, когда модель разучилась
    ссылаться.
    """
    evidence = evidence if isinstance(evidence, dict) else {}
    grounded: dict[str, Optional[list[int]]] = {}
    msgs: dict[str, list[Optional[int]]] = {}
    dropped = 0
    for key in stage_keys:
        stage_marks = marks.get(key)
        stage_evidence = evidence.get(key)
        if not isinstance(stage_evidence, (list, tuple)):
            stage_evidence = []
        if stage_marks is None:
            grounded[key] = None
            msgs[key] = [None] * ITEMS_PER_STAGE
            continue
        fixed = []
        stage_msgs = []
        for position, mark in enumerate(stage_marks):
            value = stage_evidence[position] if position < len(stage_evidence) else None
            msg = verify_evidence(value, history) if mark > 0 else None
            if mark > 0 and msg is None:
                dropped += 1
                mark = 0
            fixed.append(mark)
            stage_msgs.append(msg)
        grounded[key] = fixed
        msgs[key] = stage_msgs
    return grounded, msgs, dropped


def snapshot(
    marks: dict[str, Optional[list[int]]],
    msgs: dict[str, list[Optional[int]]],
    stage_keys: Sequence[str],
) -> list[dict]:
    """Разбор по пунктам в том виде, в каком его хранит SessionReview.checklist.

    Названия и подсказки кладутся в снимок намеренно: список могут править,
    а старый разбор обязан показывать то, по чему его ставили. `msg` —
    индекс реплики в истории; время от начала разговора фронт считает сам.
    """
    result = []
    for key in stage_keys:
        stage_marks = marks.get(key)
        stage_msgs = msgs.get(key) or [None] * ITEMS_PER_STAGE
        items = []
        for position, item in enumerate(CHECKLIST[key]):
            mark = stage_marks[position] if stage_marks is not None else 0
            msg = stage_msgs[position] if position < len(stage_msgs) else None
            items.append(
                {"n": item.n, "name": item.name, "full": item.full, "mark": mark, "msg": msg}
            )
        result.append(
            {"stage": key, "measured": stage_marks is not None, "items": items}
        )
    return result


# --- Промпт ------------------------------------------------------------------

_RULES = """Ты оцениваешь работу менеджера по продажам медицинских услуг
по ЧЕК-ЛИСТУ. Оценка — не впечатление: у каждого этапа пять действий,
и по каждому ты ставишь отметку.

0 — не выполнено: действия в разговоре не было.
1 — частично: действие было, но не так, как описано после слова «Полностью».
2 — выполнено: сделано так, как описано после слова «Полностью».
Прежде чем ставить 2, перечитай реплику-доказательство: в ней должно быть
ВСЁ, что описано после «Полностью». Чего-то нет — это 1. Поздоровался,
но не назвал имени и роли — 1, а не 2.

Числа этапов и общую оценку считает программа — ты ставишь только отметки.
Отмечай то, что видно в расшифровке; интонации не додумывай."""

_EVIDENCE = """К каждой отметке 1 или 2 укажи ДОКАЗАТЕЛЬСТВО — номер реплики менеджера,
по которой ты её поставил: число в квадратных скобках перед репликой
в расшифровке, одна реплика, самая показательная. Если действие видно
по ответу пациента, всё равно укажи реплику менеджера, которая к нему
привела. Программа сверяет номер с расшифровкой: отметка без номера или
с номером, которого нет, НЕ ЗАСЧИТЫВАЕТСЯ и становится нулём. К отметке 0
доказательства нет — null."""

_EVIDENCE_PARTIAL = """Доказательств здесь указывать не нужно — только отметки."""

_OBJECTIONS_RULE = """Возражение — сомнение, которое пациент высказал сам: про деньги,
безопасность, сроки, «надо посоветоваться». Действия этого этапа проверяются
НА КАЖДОМ возражении разговора: 2 — сделано на каждом, 1 — на части,
0 — ни на одном."""

_OBJECTIONS_FINAL = """Если пациент не высказал ни одного возражения, этап не измеряется:
objectionsRaised=false, а отметки этапа — null."""

_PARTIAL = """Расшифровка растёт: тебя зовут заново после каждой пары реплик, и оценка
обязана учитывать ПОСЛЕДНИЕ реплики. Отмечай только то, что уже прозвучало.
Действие, до которого разговор ещё не дошёл, — 0. Пациент ещё не возражал —
все действия этапа возражений 0: этап впереди, а не отсутствует."""


def rubric_block(stage_keys: Sequence[str], *, partial: bool = False) -> str:
    """Текст чек-листа для промпта оценщика.

    @param stage_keys какие этапы оценивать: четыре у фонового оценщика,
        пять у итогового, один у этапной тренировки.
    @param partial фоновый режим — расшифровка не окончена, «не дошли» = 0.
    """
    parts = [_RULES, _EVIDENCE_PARTIAL if partial else _EVIDENCE, "ЭТАПЫ И ДЕЙСТВИЯ:"]
    for key in stage_keys:
        lines = [f"{STAGE_TITLES[key]} ({key}):"]
        if key == "objections":
            lines.append(_OBJECTIONS_RULE)
            if not partial:
                lines.append(_OBJECTIONS_FINAL)
        for item in CHECKLIST[key]:
            lines.append(f"{item.n}. {item.name}. Полностью: {item.full}.")
        parts.append("\n".join(lines))
    if partial:
        parts.append(_PARTIAL)
    return "\n\n".join(parts)


def marks_schema(stage_keys: Sequence[str], *, with_evidence: bool = True) -> str:
    """Кусок описания JSON-ответа: как должны выглядеть marks и evidence."""
    marks = ", ".join(f'"{k}": [5 отметок 0|1|2]' for k in stage_keys)
    if not with_evidence:
        return f'"marks": {{{marks}}}'
    evidence = ", ".join(f'"{k}": [5 номеров реплик или null]' for k in stage_keys)
    return f'"marks": {{{marks}}}, "evidence": {{{evidence}}}'
