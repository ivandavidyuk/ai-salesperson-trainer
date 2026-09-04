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
    # Профилактика и перехват: этапа сделки у них нет, чек-лист не полагается,
    # оценка одна и ставится по их собственной рубрике
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
