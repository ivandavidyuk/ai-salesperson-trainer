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


# Отказ провайдера — 31.07.2026. Приезжает внутри успешного ответа:
# HTTP 200, finish_reason=error, ни одной дельты. Пока эту ветку не читали,
# ход терялся молча: ни лога, ни повтора. На замере тремя разговорами
# так пропадало от двух до четырёх ходов из десяти.


def test_отказ_провайдера_повторяется(monkeypatch):
    попыток = {"n": 0}

    async def поток(history, prompt):
        попыток["n"] += 1
        if попыток["n"] == 1:
            raise llm.ProviderRefused("429 rate-limited upstream")
            yield  # pragma: no cover — делает функцию генератором
        yield "Здравствуйте."

    monkeypatch.setattr(llm, "_stream_once", поток)
    assert _run(_collect([], "роль")) == ["Здравствуйте."]
    assert попыток["n"] == 2


def test_отказ_в_обеих_попытках_доходит_наверх(monkeypatch):
    async def поток(history, prompt):
        raise llm.ProviderRefused("429")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "_stream_once", поток)
    with pytest.raises(llm.ProviderRefused):
        _run(_collect([], "роль"))


# Разбор потока: ровно та ветка, где терялся ход. Подменяется http-клиент,
# чтобы проверить чтение SSE, а не управление повтором.


class _ОтветЗаглушка:
    def __init__(self, строки):
        self._строки = строки

    def raise_for_status(self):
        pass

    async def aiter_lines(self):
        for строка in self._строки:
            yield строка


class _КлиентЗаглушка:
    def __init__(self, строки):
        self._строки = строки

    def stream(self, *args, **kwargs):
        ответ = _ОтветЗаглушка(self._строки)

        class _Контекст:
            async def __aenter__(self_inner):
                return ответ

            async def __aexit__(self_inner, *exc):
                return False

        return _Контекст()


def _прогнать_поток(строки, monkeypatch):
    # Подменяем сборку запроса: предмет теста — разбор SSE, а ключа
    # к провайдеру в CI нет и быть не должно
    monkeypatch.setattr(
        llm, "_build_request", lambda *a, **kw: ("http://ключ-не-нужен", {}, {})
    )
    monkeypatch.setattr(llm, "_client", _КлиентЗаглушка(строки))

    async def go():
        return [d async for d in llm._stream_once([], "роль")]

    return _run(go())


def test_429_в_потоке_поднимает_отказ(monkeypatch):
    # HTTP 200, но внутри finish_reason=error и ни одной дельты
    строки = [
        'data: {"choices":[{"delta":{},"finish_reason":"error",'
        '"error":{"code":429,"message":"rate-limited upstream"}}]}',
        "data: [DONE]",
    ]
    with pytest.raises(llm.ProviderRefused) as exc:
        _прогнать_поток(строки, monkeypatch)
    assert "429" in str(exc.value)


def test_обычный_поток_отдаёт_дельты(monkeypatch):
    строки = [
        'data: {"choices":[{"delta":{"content":"Здрав"}}]}',
        'data: {"choices":[{"delta":{"content":"ствуйте."}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
    ]
    assert _прогнать_поток(строки, monkeypatch) == ["Здрав", "ствуйте."]


def test_обрыв_после_текста_не_поднимает_отказ(monkeypatch):
    # Часть фразы уже ушла в синтез — повтор продублировал бы речь вслух
    строки = [
        'data: {"choices":[{"delta":{"content":"Здравствуйте"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"error","error":{"code":429}}]}',
        "data: [DONE]",
    ]
    assert _прогнать_поток(строки, monkeypatch) == ["Здравствуйте"]
