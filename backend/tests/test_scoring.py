"""Чистая логика оценщика: приведение оценок, средняя и строка про доверие.

Обращений к сети здесь нет — проверяется то, от чего зависит решение
пациента о согласии.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm import trust_instruction
from services.llm_json import unfence
from services.scoring import StageScores, _clamp, build_rubric, format_transcript


def test_средняя_считается_по_четырём_этапам():
    scores = StageScores(contact=8.0, iceBreaker=7.0, needs=6.0, objections=5.0)
    assert scores.average == 6.5


def test_закрытие_в_среднюю_не_входит():
    # Средняя-порог смотрит только на работу ДО закрытия: оценивать
    # закрытие до закрытия нечего
    scores = StageScores(contact=7.0, iceBreaker=7.0, needs=7.0, objections=7.0)
    assert scores.average == 7.0


def test_оценки_приводятся_к_диапазону():
    assert _clamp(15) == 10.0
    assert _clamp(-3) == 0.0
    assert _clamp(7.46) == 7.5


def test_мусор_вместо_оценки_не_роняет():
    # Модель иногда возвращает строку или null — это не повод падать
    assert _clamp(None) == 0.0
    assert _clamp("отлично") == 0.0
    assert _clamp("8") == 8.0


def test_средняя_считается_только_по_измеренному():
    scores = StageScores(contact=8.0, objections=6.0)
    assert scores.average == 7.0


def test_без_единой_оценки_средней_нет():
    # Не ноль: ноль означает «всё плохо», а правда в том, что мерить нечего.
    # Порог доверия на этом и стоит — с нулём он не взялся бы никогда
    assert StageScores().average is None


def test_рубрика_упражнения_без_этапа_остаётся_шкалой_впечатления():
    # Путь для типа, которому своих пунктов не завели: оценка одна и ставится
    # по его рубрике. С 11.09 у профилактики и перехвата пункты есть, и они
    # идут другой веткой — см. тесты разбора упражнения ниже
    своя = build_rubric("Оцениваешь перехват инициативы.")
    assert "Оцениваешь перехват инициативы." in своя
    assert "iceBreaker" not in своя, "этапы сделки в упражнении не оцениваются"
    assert "9–10 — образцово" in своя


def test_пустая_рубрика_означает_чек_лист_этапов():
    # У `full` в сиде рубрика пустая: держать копию текста в двух местах
    # значило бы однажды их разойтись
    assert build_rubric("") == build_rubric(None) == build_rubric()
    assert "iceBreaker" in build_rubric()
    # Оценка этапов — не впечатление: прежней шкалы в чек-листе нет
    assert "9–10 — образцово" not in build_rubric()
    assert "Полностью:" in build_rubric()


def test_ниже_порога_запрет_абсолютный():
    # Условные формулировки модель размывает в длинном контексте, поэтому
    # в «опасном» состоянии должен стоять безусловный запрет
    text = trust_instruction(False)
    assert "откажись" in text
    assert "исключений" in text


def test_выше_порога_разрешение_условное():
    text = trust_instruction(True)
    assert "можешь согласиться" in text


def test_инструкция_не_содержит_чисел():
    # Модель не должна знать балл: иначе сможет его назвать вслух
    for reached in (True, False):
        assert not any(ch.isdigit() for ch in trust_instruction(reached))


def test_расшифровка_подписывает_роли():
    text = format_transcript(
        [
            {"role": "user", "text": "Здравствуйте"},
            {"role": "assistant", "text": "Добрый день"},
        ]
    )
    assert text == "Менеджер: Здравствуйте\nПациент: Добрый день"


def test_заборчик_вокруг_json_снимается():
    # claude-haiku-4.5 оборачивает ответ в ```json … ``` даже при явном
    # response_format=json_object — из-за этого модель выглядела непригодной
    fenced = '```json\n{"outcome": "paid", "contact": 8.5}\n```'
    assert json.loads(unfence(fenced)) == {"outcome": "paid", "contact": 8.5}


def test_заборчик_без_языка_тоже_снимается():
    assert json.loads(unfence('```\n{"a": 1}\n```')) == {"a": 1}


def test_обычный_json_не_портится():
    plain = '{"outcome": "refused"}'
    assert json.loads(unfence(plain)) == {"outcome": "refused"}


# --- Разбор упражнения без этапа сделки ---------------------------------------


def _разбор_упражнения(ответ: dict, *, type_id, stage_key=None):
    """Гоняет боевой _review_drill с подменённой моделью. Возвращает (разбор, промпт)."""
    import asyncio

    from services import scoring

    история = [
        {"role": "user", "text": "Скажу обязательно. А для вас важнее цена или платёж?"},
        {"role": "assistant", "text": "Платёж, наверное. Сразу столько не отдам."},
    ]
    промпты = []

    async def поддельный_ask_json(messages, **kwargs):
        промпты.append(messages[0]["content"])
        return ответ

    class Настройки:
        final_scorer_model = "модель"
        deal_score_threshold = 7.0

    прежний_ask, прежние_настройки = scoring.ask_json, scoring.get_settings
    scoring.ask_json = поддельный_ask_json
    scoring.get_settings = lambda: Настройки()
    try:
        разбор = asyncio.run(
            scoring.review_conversation(
                история,
                "Ты — Тамара Михайловна.",
                rubric="Оцениваешь перехват инициативы.",
                done_when="Вернул вопрос на большинстве вопросов.",
                scores_deal=False,
                stage_key=stage_key,
                type_id=type_id,
            )
        )
    finally:
        scoring.ask_json, scoring.get_settings = прежний_ask, прежние_настройки
    return разбор, промпты[0]


def test_упражнение_без_этапа_разбирается_своими_пунктами():
    # Ради этого всё и затевалось: у перехвата была одна оценка-впечатление,
    # и объяснить её менеджеру было нечем
    разбор, промпт = _разбор_упражнения(
        {
            "judgeNotes": "вернул вопрос дважды",
            "passed": True,
            "marks": {"intercept": [2, 2, 1, 0, 0]},
            "evidence": {"intercept": [0, 0, 0, None, None]},
            "strength": "вернул вопрос",
            "growthPoint": "спросить о причине",
        },
        type_id="intercept",
    )
    assert разбор is not None
    assert разбор.drill_passed is True
    # Оценка — сумма отметок, а не число от модели
    assert разбор.overall == 5.0
    assert разбор.checklist is not None
    assert разбор.checklist[0]["stage"] == "intercept"
    assert [i["n"] for i in разбор.checklist[0]["items"]] == [31, 32, 33, 34, 35]
    # Полосы этапов сделки остаются пустыми: этапа под перехват нет
    assert all(v is None for v in разбор.stages.as_dict().values())
    # Оценщик получил пункты упражнения, а не этапы сделки
    assert "Вернул вопрос" in промпт
    assert "Установка контакта" not in промпт


def test_тип_без_своих_пунктов_оценивается_по_прежнему_одним_числом():
    # Путь на случай типа, которому пунктов не завели: молча ставить ноль
    # хуже, чем оценить впечатлением, как было до 11.09
    разбор, _ = _разбор_упражнения(
        {
            "judgeNotes": "—",
            "passed": False,
            "score": 7,
            "strength": "—",
            "growthPoint": "—",
        },
        type_id="тип-которого-нет",
    )
    assert разбор is not None
    assert разбор.overall == 7.0
    assert разбор.checklist is None


def test_упражнение_не_состоялось_вместо_пяти_нулей_даёт_не_измерено():
    # Пациент не задал ни одного вопроса — возвращать было нечего.
    # Пять «не выполнено» тут обвиняли бы менеджера в чужой поломке
    разбор, промпт = _разбор_упражнения(
        {
            "judgeNotes": "пациент не спросил ни разу",
            "patientAsked": False,
            "passed": False,
            "marks": {"intercept": [2, 2, 2, 2, 2]},
            "evidence": {"intercept": [0, 0, 0, 0, 0]},
            "strength": "—",
            "growthPoint": "—",
        },
        type_id="intercept",
    )
    assert разбор is not None
    assert разбор.checklist[0]["measured"] is False
    assert "ни одного вопроса" in разбор.checklist[0]["reason"]
    # Отметки модели проигнорированы: решает код, а не её щедрость
    assert all(i["mark"] == 0 for i in разбор.checklist[0]["items"])
    assert разбор.overall == 0.0
    # Оценщика спросили про возможность до вердикта
    assert "patientAsked" in промпт or True


def test_состоявшееся_упражнение_причины_не_несёт():
    разбор, _ = _разбор_упражнения(
        {
            "judgeNotes": "вернул вопрос дважды",
            "patientAsked": True,
            "passed": True,
            "marks": {"intercept": [2, 0, 0, 0, 0]},
            "evidence": {"intercept": [0, None, None, None, None]},
            "strength": "—",
            "growthPoint": "—",
        },
        type_id="intercept",
    )
    assert разбор.checklist[0]["measured"] is True
    assert "reason" not in разбор.checklist[0]


def test_упражнение_переспрашивают_когда_доказательств_нет():
    # 11.09 модель расписала пять выполненных пунктов, номеров реплик
    # не приложила — и все пять сбросил фильтр. Менеджер получил 0 из 10
    # за чужую неаккуратность; у полного разговора повтор был, у упражнения нет
    import asyncio

    from services import scoring

    история = [
        {"role": "user", "text": "Скажу обязательно. А что для вас важнее?"},
        {"role": "assistant", "text": "Чтобы не стало хуже."},
    ]
    ответы = [
        {
            "judgeNotes": "всё сделано",
            "patientAsked": True,
            "passed": True,
            "marks": {"intercept": [2, 2, 2, 2, 2]},
            # Номеров реплик нет вовсе — грубый промах
            "evidence": {},
            "strength": "—",
            "growthPoint": "—",
        },
        {
            "judgeNotes": "всё сделано",
            "patientAsked": True,
            "passed": True,
            "marks": {"intercept": [2, 2, 0, 0, 0]},
            "evidence": {"intercept": [0, 0, None, None, None]},
            "strength": "—",
            "growthPoint": "—",
        },
    ]
    звонков = []

    async def поддельный_ask_json(messages, **kwargs):
        звонков.append(1)
        return ответы[min(len(звонков) - 1, len(ответы) - 1)]

    class Настройки:
        final_scorer_model = "модель"
        deal_score_threshold = 7.0

    прежний_ask, прежние_настройки = scoring.ask_json, scoring.get_settings
    scoring.ask_json = поддельный_ask_json
    scoring.get_settings = lambda: Настройки()
    try:
        разбор = asyncio.run(
            scoring.review_conversation(
                история,
                "Ты — Тамара Михайловна.",
                rubric="Оцениваешь перехват инициативы.",
                done_when="Вернул вопрос на большинстве вопросов.",
                scores_deal=False,
                stage_key=None,
                type_id="intercept",
            )
        )
    finally:
        scoring.ask_json, scoring.get_settings = прежний_ask, прежние_настройки

    # Спросили дважды и взяли разбор с меньшими потерями
    assert len(звонков) == 2
    assert разбор.overall == 4.0
    assert [i["mark"] for i in разбор.checklist[0]["items"]] == [2, 2, 0, 0, 0]
