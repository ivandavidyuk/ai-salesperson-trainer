"""Оценка разговора: порог допуска по ходу и разбор после завершения.

Два оценщика с разными задачами.

**Фоновый** считает четыре этапа после каждого хода. Его результат нужен
не для отчёта, а для решения роли: пока средняя ниже порога, пациент
отказывает при любом предложении оплатить. Работает вне критического пути —
голосовой пайплайн его не ждёт.

**Итоговый** запускается после разговора: определяет исход, ставит пять
оценок и пишет выводы. Он *записывает* исход, а не перерешает его — решение
уже прозвучало в диалоге, оценщик читает, что ответил пациент.

Рубрика этапов общая для всех пациентов и живёт здесь, а не в промпте:
от неё зависит сопоставимость оценок в недельном «Прогрессе» и статистике
отдела, где средние считаются по разным пациентам.

Подробности механизма — в DEAL-OUTCOME.md.
"""

import logging
from dataclasses import dataclass
from typing import Optional, Sequence

from core.config import get_settings
from services import checklist
from services.llm_json import ask_json

logger = logging.getLogger(__name__)

# Клиент, повторы и разбор ответа — в services/llm_json.py: тем же занят
# генератор случая, и второй реализации быть не должно.

# Итоговому оценщику повторы нужны: второго шанса у него нет, в отличие
# от фонового, который пересчитается на следующем ходу
_ATTEMPTS = 3

# Этапы в том же порядке, что и в STAGE_METRICS на фронте
STAGE_KEYS = ("contact", "iceBreaker", "needs", "objections")

_SCALE = """Ты оцениваешь работу менеджера по продажам медицинских услуг.

Шкала 0–10, ОБЯЗАТЕЛЬНО с одним знаком после запятой.
Круглое число почти всегда значит, что ты не разглядел разницу: 7.2 и 7.9 —
это разные разговоры, и путать их нельзя.

0–3 — фактически провалено или не состоялось
4–6 — сделано формально, без глубины
7–8 — сделано профессионально
9–10 — образцово

Внутри полосы обязательно различай: 7.1 — едва дотянул до полосы,
7.9 — почти образцово."""

# Этапы сделки оцениваются чек-листом (services/checklist.py): пять действий
# на этап, отметки 0/1/2, числа считает код. Шкала-впечатление ниже осталась
# только у упражнений без этапа сделки — профилактики и перехвата: у них
# своя рубрика из TrainingType.rubric и одна оценка за упражнение.

_HOW_TO_SCORE = """КАК ОЦЕНИВАТЬ:
- Расшифровка растёт: тебя вызывают заново после каждой пары реплик.
  Оценка обязана учитывать ПОСЛЕДНИЕ реплики, а не только начало разговора.
  Сделал менеджер в конце что-то заметное — оценка сдвигается.
- Найди самый сильный и самый слабый момент и ставь оценку между ними,
  ближе к тому, чего было больше.
- Оценивай только то, что видно в расшифровке. Не додумывай интонации."""

def build_rubric(
    custom: Optional[str] = None,
    *,
    stages: Optional[Sequence[str]] = None,
    partial: bool = False,
) -> str:
    """Собирает рубрику: чек-лист этапов сделки либо своя рубрика упражнения.

    Пустая строка и None означают одно и то же — «бери этапы сделки».
    В сиде у `full` рубрика пустая именно поэтому: писать ей копию того,
    что и так лежит в чек-листе, значило бы держать текст в двух местах.

    @param stages какие этапы: четыре у фонового оценщика, пять у итогового.
    @param partial фоновый режим — расшифровка растёт, «не дошли» = 0.
    """
    if custom and custom.strip():
        return f"{_SCALE}\n\n{custom.strip()}\n\n{_HOW_TO_SCORE}"
    return checklist.rubric_block(stages or checklist.STAGE_KEYS_ALL, partial=partial)


@dataclass
class StageScores:
    """Оценки этапов. Любая может отсутствовать — и это не то же, что ноль.

    В этапной тренировке считается только тренируемый этап: остальных в
    разговоре просто не было, и ноль соврал бы про менеджера, утянув ему
    недельный «Прогресс». Поэтому None означает «не измеряли», и до базы
    он доходит как NULL, который Prisma в средних не учитывает.
    """

    contact: Optional[float] = None
    iceBreaker: Optional[float] = None  # noqa: N815 — ключ в JSON и на фронте
    needs: Optional[float] = None
    objections: Optional[float] = None

    @property
    def average(self) -> Optional[float]:
        """Средняя по измеренным этапам — она и сравнивается с порогом.

        Закрытие сюда не входит: до закрытия оценивать нечего. Если не измерен
        ни один этап, средней нет — не ноль: ноль означал бы «всё плохо»,
        а правда в том, что мерить было нечего.
        """
        values = [v for v in self.as_dict().values() if v is not None]
        if not values:
            return None
        return round(sum(values) / len(values), 2)

    def as_dict(self) -> dict:
        return {
            "contact": self.contact,
            "iceBreaker": self.iceBreaker,
            "needs": self.needs,
            "objections": self.objections,
        }


def _clamp(value: object) -> float:
    """Приводит оценку к 0–10. Модель иногда возвращает строку или мусор."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(10.0, number)), 1)


def format_transcript(history: list[dict]) -> str:
    """Расшифровка в виде, пригодном для чтения моделью."""
    lines = []
    for item in history:
        who = "Менеджер" if item.get("role") == "user" else "Пациент"
        lines.append(f"{who}: {item.get('text', '')}")
    return "\n".join(lines)


async def score_stages(
    history: list[dict], patient_role: Optional[str] = None
) -> Optional[StageScores]:
    """Фоновая оценка четырёх этапов по накопленной расшифровке.

    Зовётся только для полного разговора: её единственный потребитель —
    порог доверия, а в этапной тренировке до предложения оплаты дело не
    доходит и решать роли нечего.

    `patient_role` — роль пациента: что его беспокоит и чего он боится.
    Без неё нельзя судить, докопался ли менеджер до настоящей боли, а не
    до симптомов. Рубрика при этом остаётся общей — иначе оценки разных
    пациентов станут несопоставимы, а они складываются в недельный
    «Прогресс» и статистику отдела.
    """
    if not history:
        return None

    context = (
        "\n\nКОГО ИГРАЕТ ПАЦИЕНТ — по этому тексту видно, что менеджер должен "
        f"был выяснить и какие страхи снять. Оцениваешь всё равно менеджера, "
        f"не пациента:\n{patient_role}"
        if patient_role
        else ""
    )
    result = await ask_json(
        [
            {
                "role": "system",
                "content": build_rubric(stages=STAGE_KEYS, partial=True) + context,
            },
            {
                "role": "user",
                "content": (
                    "Расшифровка разговора:\n\n"
                    f"{format_transcript(history)}\n\n"
                    "Верни JSON: {"
                    f"{checklist.marks_schema(STAGE_KEYS, with_evidence=False)}"
                    "}"
                ),
            },
        ],
        model=get_settings().scorer_model,
        purpose="этапы",
    )
    if result is None:
        return None
    # Порогу нужны числа по всем четырём этапам: этап, до которого разговор
    # не дошёл, — ноль, а не «не измерен». Иначе средняя трёх этапов взяла
    # бы порог до возражений, и пациент соглашался бы раньше времени
    marks = checklist.marks_by_stage(result.get("marks"), STAGE_KEYS)
    return StageScores(**{key: checklist.stage_score(marks[key]) for key in STAGE_KEYS})


@dataclass
class FinalReview:
    """Итог разговора.

    У полного разговора это исход сделки, пять оценок и выводы.
    У этапной тренировки сделки нет вовсе: `outcome` и `closing` остаются
    пустыми, зато появляется `drill_passed` — отработан этап или нет.
    """

    outcome: Optional[str]  # paid | refused | not_asked | None у тренировки
    stages: StageScores
    closing: Optional[float]
    overall: float
    strength: str
    growth_point: str
    judge_notes: str
    drill_passed: Optional[bool] = None
    # Разбор по пунктам — снимок для SessionReview.checklist. None у упражнений
    # без этапа сделки (профилактика, перехват): им чек-лист не полагается
    checklist: Optional[list] = None


_OUTCOMES = ("paid", "refused", "not_asked")

_FINAL_INSTRUCTIONS = """Кроме оценки этапов определи ИСХОД разговора.

Исход — это факт из диалога, а не твоё суждение о качестве работы.
Читай, что ответил пациент, и выбери одно:
- "paid" — пациент согласился оплатить услугу;
- "refused" — менеджер предложил оплатить, пациент отказался или уклонился;
- "not_asked" — менеджер так и не предложил оплатить.

Предложение об оплате распознавай ПО СМЫСЛУ. «Оформляем?», «готовы
оплатить?», «записываю вас на операцию» — всё это предложения. Никаких
дословных совпадений и ключевых слов.

"refused" и "not_asked" — разные вещи, не путай их: в одном случае менеджер
дошёл до предложения, в другом нет.

СНАЧАЛА ответь на один вопрос и положи ответ в поле paymentOffered:
прозвучало ли предложение оплатить услугу — да или нет. Отвечай по смыслу.
Вопрос «вы согласны на операцию?» — это просьба о решении, но НЕ предложение
оплатить. Дальше исход обязан этому ответу не противоречить:
paymentOffered=false может означать только "not_asked".

Отметки этапа closing ставятся по чек-листу так же, как остальные:
если предложения об оплате не было, пункты про просьбу о решении
и следующий шаг — 0.

ВЫВОДЫ для менеджера:
- strength — что действительно получилось. Честно: если разговор провален,
  назови то, что вышло, но не выдумывай похвалу.
- growthPoint — направление роста, опираясь на конкретный момент разговора.
  НЕ инструкция, что сказать в следующий раз, и не перечень условий:
  менеджер не должен получить готовый ответ.
  ЦЕЛЬСЯ В НАСТОЯЩУЮ ПРИЧИНУ. Пациент отказывает по разным поводам,
  и путать их нельзя:
  • средняя по первым четырём этапам ниже порога {threshold} — разговор
    вёлся слабо. Пиши про технику: темп, слушание, контакт. НЕ про
    аргументы: с ними могло быть всё в порядке, и совет про них
    прозвучит несправедливо;
  • средняя выше порога, но остался неснятый страх — пиши про этот страх,
    без готовых формулировок;
  • предложения об оплате не было — прямо об этом, остальное вторично.

  Оценка этапа — сумма его пяти отметок (0–10); средняя по первым четырём
  этапам — среднее этих сумм. Закрытие в неё не входит.

judgeNotes — служебное поле, менеджер его не увидит. Перечисли, какие
обязательные условия пациента сняты, а какие нет, и одной фразой почему."""

# Инструкции для этапной тренировки. Сделки здесь нет: менеджер отрабатывает
# один навык, и вопрос ровно один — отработал или нет.
_DRILL_INSTRUCTIONS = """Это не полный разговор, а тренировка одного навыка.
Сделки в ней нет: менеджер не должен предлагать оплату, и исход не оценивается.

Поставь ОДНУ оценку за упражнение — поле score.

Отдельно ответь, отработан ли этап, — поле passed. Вот чем это определяется,
и другого критерия нет:

{done_when}

Читай критерий буквально и решай ТОЛЬКО по нему. Своих условий не добавляй,
даже если по общей логике продаж разговору чего-то не хватило: упражнение
проверяет один навык, а не всю работу менеджера.

Роль пациента дана тебе, чтобы понимать, что менеджер мог из него вытянуть.
Но обязательные условия согласия и сцены с согласующим, описанные в этой
роли, к упражнению НЕ относятся — они про полный разговор. Не требуй ни
предложения оплатить, ни пройденной сцены: сегодня их и не должно быть,
и разговор без них не считается незаконченным.

Оценка и вердикт независимы в обе стороны:
- критерий выполнен, но сделано слабо → passed=true, оценка низкая;
- сделано красиво, а критерий не выполнен → passed=false, оценка высокая.

«Почти получилось» — это passed=false. «Формально выполнено, но мне не
нравится, как» — это passed=TRUE и низкая оценка.

ВЫВОДЫ для менеджера:
- strength — что действительно получилось. Честно: если упражнение провалено,
  назови то, что вышло, но не выдумывай похвалу.
- growthPoint — направление роста, опираясь на конкретный момент разговора.
  НЕ инструкция, что сказать в следующий раз: менеджер не должен получить
  готовый ответ. Если этап не отработан — целься в то, чего не хватило
  по критерию выше.

judgeNotes — служебное поле, менеджер его не увидит. Здесь разбор по критерию:
что из требуемого прозвучало, что нет, и в какой реплике. Это единственное
место, где решение «отработан или нет» можно потом перепроверить, — пиши
с опорой на реплики, а не общими словами.

ПОРЯДОК ВАЖЕН: сначала напиши judgeNotes и разбери критерий по пунктам,
и только потом поставь passed — он обязан следовать из разбора, а не
предшествовать ему. Поля в ответе идут в этом же порядке."""


_GROUNDING_ATTEMPTS = 2


@dataclass
class _Grounded:
    """Ответ итогового оценщика после сверки отметок с доказательствами."""

    result: dict
    marks: dict
    msgs: dict
    dropped: int
    positive: int

    @property
    def gross(self) -> bool:
        """Сбой, а не строгость: потеряна треть отметок и больше."""
        return self.positive >= 3 and self.dropped * 3 >= self.positive


def _ground_final(result: dict, history: list[dict]) -> _Grounded:
    # «Не измерен» у возражений решает факт, а не отметки: пациент не возражал —
    # этапа не было, и ноль за него соврал бы. В общую такой этап не входит
    unmeasured = ("objections",) if result.get("objectionsRaised") is False else ()
    marks = checklist.marks_by_stage(
        result.get("marks"), checklist.STAGE_KEYS_ALL, unmeasured=unmeasured
    )
    positive = sum(
        1 for stage in marks.values() if stage is not None for mark in stage if mark > 0
    )
    # Отметка без реплики-доказательства не засчитывается — сверка идёт
    # до подсчёта оценок, чтобы оценка этапа считалась по засчитанному
    marks, msgs, dropped = checklist.ground(
        marks, result.get("evidence"), history, checklist.STAGE_KEYS_ALL
    )
    return _Grounded(result, marks, msgs, dropped, positive)


async def review_conversation(
    history: list[dict],
    patient_prompt: str,
    *,
    rubric: Optional[str] = None,
    done_when: Optional[str] = None,
    scores_deal: bool = True,
    stage_key: Optional[str] = None,
) -> Optional[FinalReview]:
    """Итоговый разбор после разговора.

    Получает промпт пациента целиком — тот же текст, что был у роли, включая
    условия согласия. Проверка идёт по тем же условиям, которые были
    у персонажа, а не по вкусу модели.

    `scores_deal` разводит два разных разбора. У полного разговора всё как
    было: исход, четыре этапа, закрытие. У этапной тренировки — одна оценка
    и ответ «отработан ли этап» по критерию `done_when`; исхода нет, потому
    что предлагать оплату там никто и не собирался.

    `stage_key` говорит, в какую полосу этапов ложится оценка упражнения.
    У профилактики и перехвата его нет: этапа сделки под них не существует,
    и в базу идёт только общая оценка.
    """
    if not history:
        return None

    if not scores_deal:
        return await _review_drill(
            history, patient_prompt, rubric, done_when, stage_key
        )

    # Порог подставляется в инструкции: без него оценщик не сможет отличить
    # «отказала из-за слабой техники» от «отказала из-за неснятого страха»,
    # а это разные советы менеджеру
    threshold = get_settings().deal_score_threshold
    messages = [
        {
            "role": "system",
            "content": (
                f"{build_rubric(stages=checklist.STAGE_KEYS_ALL)}\n\n"
                f"{_FINAL_INSTRUCTIONS.replace('{threshold}', str(threshold))}"
            ),
        },
        {
            "role": "user",
            "content": (
                "РОЛЬ ПАЦИЕНТА (по ней он и играл, здесь же условия "
                f"его согласия):\n\n{patient_prompt}\n\n"
                "РАСШИФРОВКА РАЗГОВОРА (число в скобках — номер реплики, "
                "его указывают в evidence):\n\n"
                f"{checklist.format_numbered(history)}\n\n"
                "Верни JSON: {"
                '"paymentOffered": true | false, '
                '"outcome": "paid" | "refused" | "not_asked", '
                '"objectionsRaised": true | false, '
                f"{checklist.marks_schema(checklist.STAGE_KEYS_ALL)}, "
                '"strength": "строка", "growthPoint": "строка", '
                '"judgeNotes": "строка"}'
            ),
        },
    ]
    # Разбор, в котором доказательства не сошлись у трети отметок и больше,
    # — не строгость, а сбой: модель вернула не те номера. Один такой прогон
    # сбросил 23 отметки из 25 у хорошего разговора, повтор дал 2. Поэтому
    # при грубом расхождении спрашиваем ещё раз и берём разбор с меньшими
    # потерями — цена одного лишнего вызова против нуля в карточке
    best = None
    for attempt in range(_GROUNDING_ATTEMPTS):
        result = await ask_json(
            messages,
            model=get_settings().final_scorer_model,
            purpose="итог",
            attempts=_ATTEMPTS,
        )
        if result is None:
            break
        grounded = _ground_final(result, history)
        if best is None or grounded.dropped < best.dropped:
            best = grounded
        if not grounded.gross or attempt + 1 == _GROUNDING_ATTEMPTS:
            break
        logger.warning(
            "Оценщик: %d отметок из %d без подтверждённой реплики — спрашиваем ещё раз",
            grounded.dropped,
            grounded.positive,
        )
    if best is None:
        return None
    result, marks, msgs, dropped = best.result, best.marks, best.msgs, best.dropped

    outcome = str(result.get("outcome", "")).strip()
    if outcome not in _OUTCOMES:
        # Модель придумала своё значение — честнее не записать ничего,
        # чем записать выдуманный исход
        logger.warning("Оценщик вернул неизвестный исход %r", outcome)
        return None

    # Сверка исхода с прямым ответом «было ли предложение».
    # В первом же живом разборе оценщик написал refused, а в пояснении —
    # «предложения об оплате не было». Для менеджера это разные уроки:
    # «отказали» толкает его дожимать аргументы, хотя он просто не попросил.
    offered = result.get("paymentOffered")
    if offered is False and outcome == "refused":
        logger.warning(
            "Оценщик: предложения не было, но исход refused — исправляем "
            "на not_asked"
        )
        outcome = "not_asked"
    elif offered is False and outcome == "paid":
        # Не исправляем: согласие без предложения означает, что роль
        # размыла запрет. Это надо видеть, а не заметать
        logger.warning(
            "Оценщик: пациент согласился, хотя предложения об оплате не было "
            "— роль размыла запрет, смотреть промпт"
        )

    if dropped:
        logger.warning(
            "Оценщик: %d отметок без подтверждённой реплики сброшены в 0", dropped
        )
    scores = {key: checklist.stage_score(marks[key]) for key in checklist.STAGE_KEYS_ALL}
    stages = StageScores(**{key: scores[key] for key in STAGE_KEYS})
    closing = scores["closing"]
    # Общая оценка включает закрытие: она про весь разговор, в отличие
    # от средней-порога, которая смотрит только на работу до закрытия
    overall = checklist.overall(scores)

    return FinalReview(
        outcome=outcome,
        stages=stages,
        closing=closing,
        overall=overall,
        strength=str(result.get("strength", "")).strip(),
        growth_point=str(result.get("growthPoint", "")).strip(),
        judge_notes=str(result.get("judgeNotes", "")).strip(),
        checklist=checklist.snapshot(marks, msgs, checklist.STAGE_KEYS_ALL),
    )


async def _review_drill(
    history: list[dict],
    patient_prompt: str,
    rubric: Optional[str],
    done_when: Optional[str],
    stage_key: Optional[str],
) -> Optional[FinalReview]:
    """Разбор этапной тренировки: одна оценка и «отработан или нет».

    Роль пациента сюда тоже приходит: без неё не понять, была ли у менеджера
    возможность сделать требуемое. Раскопать «что-то своё» в человеке можно
    только если у человека это записано.
    """
    if not done_when or not done_when.strip():
        # Критерия нет — судить не по чему. Записать выдуманный вердикт хуже,
        # чем не записать никакого: менеджер поверит цифре
        logger.warning("У типа тренировки не задан doneWhen — разбор пропущен")
        return None

    # Значение приходит строкой из базы, поэтому сверяем: опечатка в сиде
    # не должна ронять разбор целиком — общая оценка важнее полосы
    if stage_key and stage_key not in STAGE_KEYS:
        logger.warning("Неизвестный stageKey %r — оценка пойдёт только в общую", stage_key)
        stage_key = None

    # Упражнение на этап сделки оценивается чек-листом своего этапа: те же
    # пять действий, что и в полном разговоре, — иначе полоса «Прогресса»
    # складывалась бы из несопоставимых чисел. Своя рубрика упражнения идёт
    # рядом как пояснение, что в нём важно. Вердикт «отработан или нет»
    # по-прежнему отвечает критерию doneWhen, а не сумме отметок.
    # Профилактика и перехват этапа не имеют — у них своя рубрика и одна
    # оценка-впечатление, как и было
    if stage_key:
        rubric_text = build_rubric(stages=(stage_key,))
        if rubric and rubric.strip():
            rubric_text += f"\n\nЧТО ВАЖНО В ЭТОМ УПРАЖНЕНИИ:\n{rubric.strip()}"
        instructions = _DRILL_INSTRUCTIONS.replace(
            "Поставь ОДНУ оценку за упражнение — поле score.",
            "Отметки по пяти действиям этапа — поле marks, номера реплик "
            "к ним — поле evidence (см. чек-лист выше). Оценку за упражнение "
            "посчитает программа по отметкам.",
        )
        answer_shape = (
            "Верни JSON строго в этом порядке полей: {"
            '"judgeNotes": "строка", "passed": true | false, '
            f"{checklist.marks_schema((stage_key,))}, "
            '"strength": "строка", "growthPoint": "строка"}'
        )
    else:
        rubric_text = build_rubric(rubric)
        instructions = _DRILL_INSTRUCTIONS
        answer_shape = (
            "Верни JSON строго в этом порядке полей: {"
            '"judgeNotes": "строка", "passed": true | false, '
            '"score": число, '
            '"strength": "строка", "growthPoint": "строка"}'
        )

    result = await ask_json(
        [
            {
                "role": "system",
                "content": (
                    f"{rubric_text}\n\n"
                    f"{instructions.replace('{done_when}', done_when.strip())}"
                ),
            },
            {
                "role": "user",
                "content": (
                    "КОГО ИГРАЛ ПАЦИЕНТ — по этому тексту видно, что менеджер "
                    "мог из него вытянуть. Оцениваешь всё равно менеджера:\n\n"
                    f"{patient_prompt}\n\n"
                    "РАСШИФРОВКА РАЗГОВОРА (число в скобках — номер реплики):\n\n"
                    f"{checklist.format_numbered(history)}\n\n"
                    # judgeNotes первым не для красоты: пока вердикт стоял
                    # раньше разбора, модель успевала выставить passed до того,
                    # как проверит критерий. В одном прогоне это видно прямо
                    # в тексте — «...формально засчитан... Стоп. Перечитываем
                    # критерий» — и дальше верное рассуждение при неверном
                    # булевом поле
                    f"{answer_shape}"
                ),
            },
        ],
        model=get_settings().final_scorer_model,
        purpose="итог этапа",
        attempts=_ATTEMPTS,
    )
    if result is None:
        return None

    snapshot = None
    if stage_key:
        marks = checklist.marks_by_stage(result.get("marks"), (stage_key,))
        marks, msgs, dropped = checklist.ground(
            marks, result.get("evidence"), history, (stage_key,)
        )
        if dropped:
            logger.warning(
                "Оценщик этапа: %d отметок без подтверждённой реплики сброшены в 0",
                dropped,
            )
        score = checklist.stage_score(marks[stage_key]) or 0.0
        snapshot = checklist.snapshot(marks, msgs, (stage_key,))
    else:
        score = _clamp(result.get("score"))
    passed = result.get("passed")
    if not isinstance(passed, bool):
        # Вердикт — единственное, ради чего эта тренировка и затевалась.
        # Догадываться о нём по оценке нельзя: строгий критерий и высокий балл
        # уживаются, «почти получилось» — это провал при оценке 8
        logger.warning("Оценщик не вернул passed булевым: %r", passed)
        return None

    # Оценка ложится и в полосу этапа, если он у упражнения есть: тренировка
    # контакта должна двигать менеджеру полосу контакта, а не висеть отдельно
    stages = StageScores(**{stage_key: score}) if stage_key else StageScores()

    return FinalReview(
        outcome=None,
        stages=stages,
        closing=None,
        overall=score,
        strength=str(result.get("strength", "")).strip(),
        growth_point=str(result.get("growthPoint", "")).strip(),
        judge_notes=str(result.get("judgeNotes", "")).strip(),
        drill_passed=passed,
        checklist=snapshot,
    )
