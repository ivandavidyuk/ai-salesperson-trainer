"""Сорвавшийся старт разговора (main._сбой_старта, SessionStore.close_failed_start).

15.10 первый разговор Jamaica упал на старте: исключение ушло в ASGI,
менеджер остался на экране «Связь прервалась. Завершите разговор», сессия
повисла active. Здесь проверяется уборка после такого сбоя: человеку —
правда и кнопка «ещё раз», сессии — закрытие с длительностью 0, чужая
сессия — не трогается.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402
from services.session import STATUS_COMPLETED, SessionStore  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


# --- SessionStore.close_failed_start ------------------------------------


class _Pool:
    def __init__(self, ответ):
        self.ответ = ответ
        self.запросы = []

    async def fetchrow(self, sql, *args):
        self.запросы.append((sql, args))
        return self.ответ


class _Redis:
    def __init__(self):
        self.записи = {}

    async def set(self, key, value):
        self.записи[key] = value


def _store(ответ):
    store = SessionStore()
    store._pool = _Pool(ответ)
    store._redis = _Redis()
    return store


def test_несостоявшийся_старт_закрывается_с_нулём():
    store = _store({"id": "s1"})
    assert _run(store.close_failed_start("s1", "u1")) is True
    sql, args = store._pool.запросы[0]
    # Длительность 0 и конец = начало: счётчик часов не спишет ничего
    assert '"durationSec" = 0' in sql and '"endedAt" = "startedAt"' in sql
    assert args == ("s1", "u1")
    assert store._redis.записи["session:s1:status"] == STATUS_COMPLETED


def test_чужую_и_живую_сессию_не_трогаем():
    store = _store(None)  # условие не совпало: чужая, уже закрыта или были реплики
    assert _run(store.close_failed_start("s1", "u1")) is False
    sql, _ = store._pool.запросы[0]
    assert '"userId" = $2' in sql
    assert "NOT EXISTS" in sql and '"Message"' in sql
    assert '"status" <> \'completed\'' in sql
    assert store._redis.записи == {}


# --- main._сбой_старта --------------------------------------------------


class _WS:
    def __init__(self):
        self.отправлено = []
        self.код = None

    async def send_json(self, message):
        self.отправлено.append(message)

    async def close(self, code=1000):
        self.код = code


class _Поток:
    def __init__(self):
        self.остановлен = False

    async def stop(self):
        self.остановлен = True


class _Хранилище:
    def __init__(self, сломано=False):
        self.закрыто = []
        self.очищено = []
        self.сломано = сломано

    async def close_failed_start(self, session_id, user_id):
        if self.сломано:
            raise ConnectionResetError("база недоступна")
        self.закрыто.append((session_id, user_id))
        return True

    async def clear_session(self, session_id):
        self.очищено.append(session_id)


def test_сбой_старта_говорит_правду_и_закрывает_сессию(monkeypatch):
    хранилище = _Хранилище()
    monkeypatch.setattr(main, "store", хранилище)
    ws, tts, stt = _WS(), _Поток(), _Поток()

    _run(main._сбой_старта(ws, "s1", "u1", tts, stt, ConnectionResetError("reset")))

    assert ws.отправлено == [{"type": "start_failed", "message": main._СБОЙ_СТАРТА}]
    assert ws.код == 1011
    assert хранилище.закрыто == [("s1", "u1")]
    assert хранилище.очищено == ["s1"]
    assert tts.остановлен and stt.остановлен


def test_без_пользователя_сессию_не_закрываем(monkeypatch):
    # Сбой до проверки токена: чья это сессия, неизвестно
    хранилище = _Хранилище()
    monkeypatch.setattr(main, "store", хранилище)
    ws = _WS()

    _run(main._сбой_старта(ws, "s1", None, None, None, RuntimeError("redis")))

    assert хранилище.закрыто == []
    assert ws.отправлено[0]["type"] == "start_failed"
    assert ws.код == 1011


def test_база_лежит_а_человеку_всё_равно_говорим(monkeypatch):
    # Второй сбой — уже при закрытии — не должен оставить сокет открытым
    monkeypatch.setattr(main, "store", _Хранилище(сломано=True))
    ws = _WS()

    _run(main._сбой_старта(ws, "s1", "u1", None, None, ConnectionResetError("reset")))

    assert ws.отправлено[0]["type"] == "start_failed"
    assert ws.код == 1011
