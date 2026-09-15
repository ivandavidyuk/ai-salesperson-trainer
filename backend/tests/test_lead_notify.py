"""Уведомление о заявке с лендинга: разбор тела и текст сообщения.

Отправка идёт с DE, потому что RU-сервер не достаёт Telegram по IPv4.
Проверяем чистую часть: что заявка разбирается так же строго, как
на фронтенде, и что в сообщении есть ссылка, по которой Дима напишет
человеку одним нажатием.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import lead_notify  # noqa: E402

VALID = {
    "name": " Иван ",
    "telegram": "@test_user",
    "industry": "стоматология",
    "teamSize": "3–5",
}


def test_валидная_заявка_разбирается_и_обрезает_пробелы():
    lead = lead_notify.parse_lead(VALID)
    assert lead is not None
    assert lead["name"] == "Иван"


def test_заявка_без_поля_отвергается():
    body = {**VALID}
    del body["industry"]
    assert lead_notify.parse_lead(body) is None


def test_пустое_и_слишком_длинное_поле_отвергаются():
    assert lead_notify.parse_lead({**VALID, "name": "   "}) is None
    assert lead_notify.parse_lead({**VALID, "name": "а" * 101}) is None


def test_размер_отдела_только_из_списка_фронтенда():
    assert lead_notify.parse_lead({**VALID, "teamSize": "7"}) is None
    assert lead_notify.parse_lead({**VALID, "teamSize": "больше 15"}) is not None


def test_не_словарь_отвергается():
    assert lead_notify.parse_lead(["нет"]) is None


def test_ник_превращается_в_ссылку():
    text = lead_notify.format_lead(lead_notify.parse_lead(VALID))
    assert "@test_user — https://t.me/test_user" in text
    assert "Менеджеров в отделе: 3–5" in text


def test_номер_телефона_остаётся_без_ссылки():
    lead = lead_notify.parse_lead({**VALID, "telegram": "+7 900 000-00-00"})
    text = lead_notify.format_lead(lead)
    assert "Telegram: +7 900 000-00-00" in text
    assert "t.me" not in text


def test_без_настроек_отправка_честно_не_удаётся(monkeypatch):
    settings = lead_notify.get_settings()
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    monkeypatch.setattr(settings, "telegram_leads_chat_id", "")
    lead = lead_notify.parse_lead(VALID)
    assert asyncio.run(lead_notify.send_lead(lead)) is False


# --- Роут /leads/notify ----------------------------------------------------
#
# Лиды приходят от Next.js со служебным токеном. Проверяем, что без подписи
# роут закрыт, кривую заявку не шлёт, а неудачу Telegram не выдаёт за успех.

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

SECRET = "тестовый-секрет-для-подписи-токена-лидов"


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(main.get_settings(), "jwt_secret", SECRET)
    return TestClient(main.app)


def _auth() -> dict:
    token = jwt.encode({"sub": "landing-leads"}, SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def test_роут_без_токена_закрыт(monkeypatch):
    response = _client(monkeypatch).post("/leads/notify", json=VALID)
    assert response.status_code == 401


def test_роут_отвергает_кривую_заявку(monkeypatch):
    response = _client(monkeypatch).post(
        "/leads/notify", json={**VALID, "teamSize": "7"}, headers=_auth()
    )
    assert response.status_code == 400


def test_роут_не_выдаёт_неудачу_telegram_за_успех(monkeypatch):
    async def fail(_lead):
        return False

    monkeypatch.setattr(lead_notify, "send_lead", fail)
    response = _client(monkeypatch).post("/leads/notify", json=VALID, headers=_auth())
    assert response.status_code == 502


def test_роут_отправляет_валидную_заявку(monkeypatch):
    sent = []

    async def ok(lead):
        sent.append(lead)
        return True

    monkeypatch.setattr(lead_notify, "send_lead", ok)
    response = _client(monkeypatch).post("/leads/notify", json=VALID, headers=_auth())
    assert response.status_code == 200
    assert sent and sent[0]["name"] == "Иван"
