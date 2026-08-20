"""Закрытие сессии, оборвавшейся без «стоп».

Разговор может кончиться закрытой вкладкой, упавшим браузером или пропавшей
сетью. Роут /stop зовёт только кнопка «Завершить», поэтому такую сессию
не закроет никто, и она останется active навсегда — её минуты не попадут
ни в статистику менеджера, ни в счётчик часов клиента, хотя оплачены.

Здесь проверяется управление: что закрываем ровно незакрытое, что штатное
завершение не перезаписываем и что Redis не расходится с базой. Сам SQL
проверяется отдельно, на живом Postgres — подделка не докажет, что запрос
исполним.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.session import STATUS_COMPLETED, SessionStore


class ПоддельныйPool:
    """Пул, который возвращает заранее заданный ответ и помнит запросы."""

    def __init__(self, ответ):
        self.ответ = ответ
        self.запросы: list[tuple] = []

    async def fetchrow(self, sql, *args):
        self.запросы.append((sql, args))
        return self.ответ


class ПоддельныйRedis:
    def __init__(self):
        self.записи: dict[str, str] = {}

    async def set(self, key, value):
        self.записи[key] = value


def _store(ответ):
    store = SessionStore()
    store._pool = ПоддельныйPool(ответ)
    store._redis = ПоддельныйRedis()
    return store


def _run(coro):
    return asyncio.run(coro)


def test_оборванная_сессия_закрывается_и_отдаёт_длительность():
    store = _store({"durationSec": 187})

    assert _run(store.finish_if_unfinished("s1")) == 187
    assert store._redis.записи["session:s1:status"] == STATUS_COMPLETED


def test_уже_завершённую_не_трогаем():
    # UPDATE не нашёл строки — значит статус уже completed и длительность
    # проставил роут /stop. Перезапись здесь испортила бы верное значение.
    store = _store(None)

    assert _run(store.finish_if_unfinished("s1")) is None
    assert store._redis.записи == {}


def test_запрос_закрывает_только_незавершённые():
    store = _store({"durationSec": 5})
    _run(store.finish_if_unfinished("s1"))

    sql, args = store._pool.запросы[0]
    # Условие — единственное, что отделяет штатное завершение от обрыва
    assert '"status" <> \'completed\'' in sql
    assert args == ("s1",)


def test_длительность_считает_база_а_не_питон():
    # У бэкенда на DE и у роутов Next на RU разные часы. Считай мы время
    # в питоне, расхождение попало бы клиенту в счёт за разговор.
    store = _store({"durationSec": 5})
    _run(store.finish_if_unfinished("s1"))

    sql, _ = store._pool.запросы[0]
    assert "NOW() - \"startedAt\"" in sql
    assert "GREATEST(0" in sql


def test_сессия_на_паузе_тоже_закрывается():
    # Пауза с мёртвым сокетом — тот же брошенный разговор: статус не
    # completed, значит условие совпадёт и строка обновится.
    store = _store({"durationSec": 42})

    assert _run(store.finish_if_unfinished("s1")) == 42
    assert store._redis.записи["session:s1:status"] == STATUS_COMPLETED


# --- Блок завершения сессии -------------------------------------------------
#
# Здесь проверяется главное свойство: сбой хранилища не имеет права помешать
# разговору закрыться. Функция зовётся из finally, и если она бросит, сессия
# останется с висящим сокетом и незакрытыми STT/TTS.

import main  # noqa: E402


class ПоддельныйStore:
    def __init__(self, длительность=None, ошибка=None):
        self.длительность = длительность
        self.ошибка = ошибка
        self.очищено: list[str] = []

    async def finish_if_unfinished(self, session_id):
        if self.ошибка:
            raise self.ошибка
        return self.длительность

    async def clear_session(self, session_id):
        self.очищено.append(session_id)


def test_оборванный_разговор_закрывается_и_чистит_redis(monkeypatch):
    store = ПоддельныйStore(длительность=300)
    monkeypatch.setattr(main, "store", store)

    assert _run(main.close_if_abandoned("s1")) == 300
    assert store.очищено == ["s1"]


def test_штатное_завершение_redis_не_трогает(monkeypatch):
    # Ветка «стоп» уже позвала clear_session сама. Второй вызов безвреден,
    # но его отсутствие — признак, что мы не лезем в чужой путь.
    store = ПоддельныйStore(длительность=None)
    monkeypatch.setattr(main, "store", store)

    assert _run(main.close_if_abandoned("s1")) is None
    assert store.очищено == []


def test_упавшее_хранилище_не_ломает_завершение(monkeypatch):
    # Ради этого свойства функция и вынесена отдельно: она в finally,
    # и её исключение оставило бы висеть сокет, STT и TTS.
    store = ПоддельныйStore(ошибка=RuntimeError("база недоступна"))
    monkeypatch.setattr(main, "store", store)

    assert _run(main.close_if_abandoned("s1")) is None


def test_сбой_очистки_redis_тоже_не_пробрасывается(monkeypatch):
    store = ПоддельныйStore(длительность=10)

    async def падает(session_id):
        raise RuntimeError("redis недоступен")

    store.clear_session = падает
    monkeypatch.setattr(main, "store", store)

    assert _run(main.close_if_abandoned("s1")) is None
