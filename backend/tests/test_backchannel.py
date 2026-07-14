"""Тесты классификатора поддакиваний (barge-in только на осмысленную речь).

Чистые функции из main.py: _is_backchannel_only / _meaningful_words.
Запуск: из папки backend — `pytest tests/` (или `python -m pytest tests/`).
"""

import os
import sys

# Импорт main.py из родительской папки backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import _is_backchannel_only, _meaningful_words  # noqa: E402


# Реплики целиком из поддакиваний — перебивать/отвечать нельзя
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
