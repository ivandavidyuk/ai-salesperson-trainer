"""Повтор запроса к модели, когда она молчит.

Сети здесь нет: подменяется _stream_once, проверяется только управление
повтором. Цена ошибки высокая — повтор после того, как часть фразы ушла
в синтез, продублировал бы речь пациента вслух.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import llm


async def _collect(history, prompt):
    return [delta async for delta in llm.stream_reply(history, prompt)]


def _run(coro):
    return asyncio.run(coro)


def test_молчание_на_первой_попытке_приводит_ко_второй(monkeypatch):
    calls = []

    async def fake_stream(history, prompt):
        calls.append(len(calls) + 1)
        if len(calls) == 1:
            await asyncio.sleep(10)  # молчит дольше потолка
            yield "не должно прозвучать"
        else:
            yield "Здравствуйте."

    monkeypatch.setattr(llm, "_stream_once", fake_stream)
    monkeypatch.setattr(llm, "_FIRST_TOKEN_TIMEOUT_SEC", 0.05)

    assert _run(_collect([], "роль")) == ["Здравствуйте."]
    assert len(calls) == 2


def test_молчание_в_обеих_попытках_пробрасывает_ошибку(monkeypatch):
    async def fake_stream(history, prompt):
        await asyncio.sleep(10)
        yield "тишина"

    monkeypatch.setattr(llm, "_stream_once", fake_stream)
    monkeypatch.setattr(llm, "_FIRST_TOKEN_TIMEOUT_SEC", 0.05)

    with pytest.raises(asyncio.TimeoutError):
        _run(_collect([], "роль"))


def test_обрыв_после_первого_токена_не_повторяется(monkeypatch):
    """Главная страховка: половина фразы уже в синтезе, повтор её удвоит."""
    calls = []

    async def fake_stream(history, prompt):
        calls.append(len(calls) + 1)
        yield "Первое предложение."
        raise RuntimeError("провайдер оборвал поток")

    monkeypatch.setattr(llm, "_stream_once", fake_stream)
    monkeypatch.setattr(llm, "_FIRST_TOKEN_TIMEOUT_SEC", 0.05)

    with pytest.raises(RuntimeError):
        _run(_collect([], "роль"))
    assert len(calls) == 1


def test_пустой_ответ_не_повторяется(monkeypatch):
    """Модель ответила «ничего» — это ответ, а не молчание."""
    calls = []

    async def fake_stream(history, prompt):
        calls.append(len(calls) + 1)
        return
        yield  # pragma: no cover — делает функцию генератором

    monkeypatch.setattr(llm, "_stream_once", fake_stream)
    monkeypatch.setattr(llm, "_FIRST_TOKEN_TIMEOUT_SEC", 0.05)

    assert _run(_collect([], "роль")) == []
    assert len(calls) == 1
