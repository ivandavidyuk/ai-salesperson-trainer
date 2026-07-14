"""Тесты классификатора поддакиваний (barge-in только на осмысленную речь).

Чистые функции из main.py: _is_backchannel_only / _meaningful_words.
Запуск: из папки backend — `pytest tests/` (или `python -m pytest tests/`).
"""

import os
import sys

# Импорт main.py из родительской папки backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import (  # noqa: E402
    _INTERRUPT_COMMANDS,
    _is_backchannel_only,
    _meaningful_words,
)


# Реплики целиком из поддакиваний — перебивать/отвечать нельзя.
# Включая удлинения и «мычащие» варианты, которые STT пишет по-разному.
BACKCHANNEL_ONLY = [
    "угу",
    "ага",
    "да",
    "да-да",
    "мм",
    "угу-угу",
    "мм угу",
    "да, да",
    "ну да",
    "так-так",
    "понятно",
    "ясно",
    "ага, угу",
    "дааа",       # удлинение → «да»
    "эээ",        # удлинение → «э»
    "мхм",        # мычащий вариант
    "нгм",        # мычащий вариант
    "угм угу",
]

# Осмысленные реплики — должны перебивать и порождать ответ
MEANINGFUL = [
    "извините давайте доктора",
    "а сколько стоит",
    "понятно, а когда операция",
    "стоп",
    "секунду",
    "да, давайте запишемся",
    "нет, я подумаю",
]


def test_backchannel_only_is_detected():
    for text in BACKCHANNEL_ONLY:
        assert _is_backchannel_only(text), f"должно быть поддакиванием: {text!r}"
        assert _meaningful_words(text) == [], f"осмысленных слов быть не должно: {text!r}"


def test_meaningful_is_not_backchannel():
    for text in MEANINGFUL:
        assert not _is_backchannel_only(text), f"не должно быть поддакиванием: {text!r}"
        assert _meaningful_words(text), f"должны быть осмысленные слова: {text!r}"


def test_empty_is_not_backchannel():
    # Пустая/пробельная строка — не поддакивание (нечего отбрасывать)
    assert not _is_backchannel_only("")
    assert not _is_backchannel_only("   ")


def test_interrupt_commands_are_meaningful():
    # Команды-перебивания не должны считаться поддакиванием (перебивают)
    for cmd in ("стоп", "подождите", "секунду", "извините", "простите"):
        assert cmd in _INTERRUPT_COMMANDS
        assert not _is_backchannel_only(cmd), f"команда не поддакивание: {cmd!r}"


def _would_barge_in(text: str) -> bool:
    """Модель порога on_partial: ≥2 осмысленных слова ИЛИ команда."""
    fresh = _meaningful_words(text)
    has_command = any(w in _INTERRUPT_COMMANDS for w in fresh)
    return len(fresh) >= 2 or has_command


def test_barge_in_threshold():
    # Единичный шумно-распознанный звук («мгм» → «него») не перебивает
    assert not _would_barge_in("него")
    assert not _would_barge_in("угу")
    assert not _would_barge_in("ну да")
    # Осмысленное перебивание и команды — перебивают
    assert _would_barge_in("извините давайте доктора")
    assert _would_barge_in("а сколько стоит")
    assert _would_barge_in("стоп")            # одна команда
    assert _would_barge_in("извините")        # одна команда
