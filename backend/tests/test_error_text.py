"""Текст сбоя: то, что попадает в лог и на экран менеджеру.

Повод — живой разговор 30.07.2026. Провайдер модели роли замолчал, потолок
первого токена сработал в обеих попытках, ход потерялся. У asyncio.TimeoutError
строковое представление пустое, поэтому в логе запись обрывалась на двоеточии,
а менеджер увидел «Ошибка обработки:» без причины.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import _describe, _user_message  # noqa: E402


def test_пустое_исключение_описывается_типом():
    assert _describe(asyncio.TimeoutError()) == "TimeoutError"


def test_исключение_с_текстом_сохраняет_текст():
    assert _describe(ValueError("нет ключа")) == "ValueError: нет ключа"


def test_таймаут_объясняется_менеджеру_словами():
    # Менеджеру нужно знать, что делать дальше, а не как зовут исключение
    message = _user_message(asyncio.TimeoutError())
    assert "повторите" in message.lower()
    assert "TimeoutError" not in message


def test_неизвестный_сбой_показывает_тип_а_не_пустоту():
    message = _user_message(RuntimeError())
    assert message.endswith("RuntimeError")
    # Прежняя версия давала ровно это — надпись без причины
    assert message != "Ошибка обработки: "
