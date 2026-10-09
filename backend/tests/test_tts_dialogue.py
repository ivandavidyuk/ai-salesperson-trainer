"""Сокет v4 Turbo: выбор модели и разбор ответа.

С 09.10 v4 Turbo — голос пациентов по умолчанию, Flash остался стенду
(?tts=flash). У v4 Turbo свой сокет с другими именами полей, и перебивание
держится на том, что звук брошенного предложения не попадает в следующее.
"""

import base64
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import tts  # noqa: E402


def test_v4_по_умолчанию():
    # Без параметра, со стендовым «v4» и с опечаткой — основной голос
    for param in (None, "", "v4", "V4", "flash ", "Flash"):
        stream = tts.stream_for(param, "voice")
        assert isinstance(stream, tts.DialogueWsStream)
        assert stream.model == "eleven_v4_turbo"


def test_flash_только_по_параметру_стенда():
    assert isinstance(tts.stream_for("flash", "voice"), tts.TtsWsStream)


def test_звук_своего_контекста():
    msg = {"context_id": "s2", "audio": base64.b64encode(b"mp3").decode()}
    assert tts.parse_dialogue_message(msg, "s2") == (b"mp3", False)


def test_звук_брошенного_контекста_пропускается():
    # Запоздавший кусок предложения, брошенного при перебивании
    msg = {"context_id": "s1", "audio": base64.b64encode(b"old").decode()}
    assert tts.parse_dialogue_message(msg, "s2") == (None, False)


def test_конец_своего_предложения():
    assert tts.parse_dialogue_message({"context_id": "s2", "is_final": True}, "s2") == (
        None,
        True,
    )


def test_конец_чужого_предложения_не_конец_своего():
    assert tts.parse_dialogue_message({"context_id": "s1", "is_final": True}, "s2") == (
        None,
        False,
    )


def test_ошибка_протокола_исключение():
    # Ошибка закрывает соединение целиком: пропустить её — ждать звука,
    # который не придёт, до таймаута
    with pytest.raises(RuntimeError):
        tts.parse_dialogue_message(
            {"error": "context_limit", "message": "too many contexts"}, "s2"
        )
