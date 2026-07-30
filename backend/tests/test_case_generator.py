"""Проверка формы ответа генератора случая.

Повод — замер 30.07.2026: одна модель вернула сорок шесть примеров манеры
вместо двух. Это не отказ провайдера, а тихий мусор: все поля на месте,
JSON корректен, и без счёта элементов такой ответ уехал бы в промпт,
который менеджер услышит голосом.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.case_generator import build_messages, validate_case  # noqa: E402


def годный_случай() -> dict:
    return {
        "situation": "Ноет зуб снизу справа, недели три.",
        "calmWhile": "Пока разговор про осмотр — спокойна.",
        "mannerExamples": [
            "  Менеджер: «Давно болит?» → «Недели три.»",
            "  Менеджер: «Расскажите подробнее?» → «Сначала на холодное, теперь и так.»",
        ],
        "caseConditions": ["Снят страх боли.", "Снят страх денег."],
        "caseHelps": ["связал лечение с тем, что трудно жевать"],
        "vocabulary": ["зуб", "пломб", "канал", "коронк", "жеват"],
        "anamnesis": "Боль в нижнем правом жевательном зубе три недели.",
        "description": "62 года · лечение зуба",
        "objections": ["«А это не опасно?»", "«Дорого»", "«Надо с мужем»"],
    }


def test_годный_случай_проходит():
    assert validate_case(годный_случай()) is None


def test_сорок_шесть_примеров_манеры_не_проходят():
    # Ровно тот случай, ради которого написана проверка
    case = годный_случай()
    case["mannerExamples"] = ["  Менеджер: «?» → «!»"] * 46
    problem = validate_case(case)
    assert problem is not None and "46" in problem


def test_примеры_строкой_разбираются_на_список():
    case = годный_случай()
    case["mannerExamples"] = "  Менеджер: «А?» → «Б.»\n  Менеджер: «В?» → «Г.»"
    assert validate_case(case) is None
    assert isinstance(case["mannerExamples"], list)


def test_пустое_поле_считается_отсутствующим():
    case = годный_случай()
    case["anamnesis"] = ""
    problem = validate_case(case)
    assert problem is not None and "anamnesis" in problem


def test_короткий_словарь_не_проходит():
    # Без словаря проверка на протечку отрасли в личность слепнет
    case = годный_случай()
    case["vocabulary"] = ["зуб"]
    problem = validate_case(case)
    assert problem is not None and "словарь" in problem


def test_услуги_и_личность_попадают_в_запрос():
    messages = build_messages(
        {"identity": "Ты — Тамара, 62 года.", "fears": ["боится боли"]},
        {
            "name": "Дентал Плюс",
            "industry": "стоматология",
            "services": [{"name": "Пломба", "price": "8 500 ₽", "description": "час"}],
        },
    )
    текст = messages[1]["content"]
    assert "Дентал Плюс" in текст
    assert "8 500 ₽" in текст
    assert "боится боли" in текст
    # Инструкция отдельным сообщением, а не подмешана к данным
    assert "МЕНЯТЬСЯ НЕ ДОЛЖНА" in messages[0]["content"]
