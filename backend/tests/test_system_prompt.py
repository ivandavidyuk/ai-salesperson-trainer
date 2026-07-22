"""Тесты сборки системного промпта из роли пациента и этапа тренировки.

Чистая функция build_system_prompt из services/llm.py.
Запуск: из папки backend — `pytest tests/`.
"""

import os
import sys

# Импорт пакета services из родительской папки backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.llm import build_system_prompt  # noqa: E402

ROLE = "Ты — Тамара Михайловна, 62 года."
STAGE = "Отрабатывается установка контакта."


def test_роль_и_этап_склеиваются():
    result = build_system_prompt(ROLE, STAGE)
    assert result.startswith(ROLE)
    assert STAGE in result
    # Этап идёт после роли и отделён заголовком
    assert result.index("ЭТАП РАЗГОВОРА:") > result.index(ROLE)


def test_без_этапа_остаётся_только_роль():
    # Сессии до мастера настройки не имеют типа тренировки
    assert build_system_prompt(ROLE, None) == ROLE
    assert build_system_prompt(ROLE, "") == ROLE
    assert build_system_prompt(ROLE) == ROLE


def test_пустой_этап_не_добавляет_пустой_блок():
    # Пробелы вместо промпта не должны порождать болтающийся заголовок
    assert "ЭТАП РАЗГОВОРА" not in build_system_prompt(ROLE, "   \n  ")


def test_без_роли_промпт_пустой():
    # Отсутствие промпта пациента — сигнал не начинать разговор
    assert build_system_prompt(None) == ""
    assert build_system_prompt("") == ""
    assert build_system_prompt("   ") == ""


def test_без_роли_но_с_этапом_промпт_не_теряется():
    # Роли нет, но этап есть — возвращаем хотя бы этап, а не пустую строку:
    # решение «начинать или нет» принимает вызывающий код
    result = build_system_prompt(None, STAGE)
    assert STAGE in result


def test_лишние_пробелы_обрезаются():
    result = build_system_prompt(f"  {ROLE}  ", f"\n{STAGE}\n")
    assert result == f"{ROLE}\n\nЭТАП РАЗГОВОРА:\n{STAGE}"
