"""Чистая логика оценщика: приведение оценок, средняя и строка про доверие.

Обращений к сети здесь нет — проверяется то, от чего зависит решение
пациента о согласии.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm import trust_instruction
from services.scoring import StageScores, _clamp, _unfence, format_transcript


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


def test_разбор_ответа_модели():
    scores = StageScores.from_dict(
        {"contact": 9, "iceBreaker": "6.5", "needs": None, "objections": 100}
    )
    assert scores.contact == 9.0
    assert scores.iceBreaker == 6.5
    assert scores.needs == 0.0
    assert scores.objections == 10.0


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
    assert json.loads(_unfence(fenced)) == {"outcome": "paid", "contact": 8.5}


def test_заборчик_без_языка_тоже_снимается():
    assert json.loads(_unfence('```\n{"a": 1}\n```')) == {"a": 1}


def test_обычный_json_не_портится():
    plain = '{"outcome": "refused"}'
    assert json.loads(_unfence(plain)) == {"outcome": "refused"}
