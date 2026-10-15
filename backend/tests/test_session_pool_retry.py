"""Повтор запроса к Postgres на мёртвом соединении (services/session.py).

15.10 первый разговор первой клиники не начался: соединение пула пролежало
ночь, сеть его оборвала, и первый же запрос сессии упал. Сети здесь нет —
подменяется пул, проверяется только управление повтором.
"""

import asyncio
import os
import sys

import asyncpg
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.session import ПулСПовтором  # noqa: E402


class _Пул:
    """Пул, который отвечает по очереди заданными исходами."""

    def __init__(self, исходы):
        self.исходы = list(исходы)
        self.вызовы = 0

    async def _ответ(self, *args):
        self.вызовы += 1
        исход = self.исходы.pop(0)
        if isinstance(исход, BaseException):
            raise исход
        return исход

    fetchrow = fetch = fetchval = execute = _ответ


def _run(coro):
    return asyncio.run(coro)


def test_мёртвое_соединение_повторяется_на_новом():
    пул = _Пул([ConnectionResetError(104, "Connection reset by peer"), {"status": "active"}])
    assert _run(ПулСПовтором(пул).fetchrow("SELECT", 1)) == {"status": "active"}
    assert пул.вызовы == 2


def test_закрытое_посреди_операции_тоже_повторяется():
    ошибка = asyncpg.exceptions.ConnectionDoesNotExistError(
        "connection was closed in the middle of operation"
    )
    пул = _Пул([ошибка, "UPDATE 1"])
    assert _run(ПулСПовтором(пул).execute("UPDATE")) == "UPDATE 1"
    assert пул.вызовы == 2


def test_два_сбоя_подряд_доходят_наверх():
    # Второй раз — уже не простой, а база или сеть: прятать нельзя
    пул = _Пул([ConnectionResetError(), ConnectionResetError()])
    with pytest.raises(ConnectionResetError):
        _run(ПулСПовтором(пул).fetch("SELECT"))
    assert пул.вызовы == 2


def test_ошибка_запроса_не_повторяется():
    # Ошибка в самом SQL повтором не лечится — сразу наверх
    пул = _Пул([asyncpg.exceptions.UndefinedColumnError("нет столбца"), None])
    with pytest.raises(asyncpg.exceptions.UndefinedColumnError):
        _run(ПулСПовтором(пул).fetchrow("SELECT"))
    assert пул.вызовы == 1
