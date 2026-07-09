# WebSocket-сервер — голосовой пайплайн

Python FastAPI сервис рядом с Next.js. Реализует WebSocket-эндпоинт и
голосовой пайплайн STT → LLM → TTS на базе ElevenLabs и OpenRouter.

## Стек

- **FastAPI** + **uvicorn**, Python 3.11+
- **websockets** — ElevenLabs Realtime STT и multi-context TTS (WebSocket)
- **httpx** — OpenRouter LLM (SSE-стриминг)
- **redis** (async) — кэш сессий, ws-токены
- **asyncpg** — сообщения в PostgreSQL (фоновая запись)
- **PyJWT** — проверка JWT (тот же секрет, что в Next.js)

## Структура

```
backend/
  main.py              # FastAPI, WS-эндпоинт, оркестрация пайплайна
  services/
    stt.py             # ElevenLabs Realtime STT + семантический коммит
    tts.py             # ElevenLabs TTS (постоянный WebSocket на сессию)
    llm.py             # OpenRouter (стриминг) + системный промпт
    session.py         # Redis-кэш + PostgreSQL
  core/
    config.py          # настройки из .env
    auth.py            # проверка JWT
  requirements.txt
  .env.example
```

## WebSocket-протокол

```
WS /ws/session/{session_id}?token=<ws_token>
```

Авторизация — одноразовый ws-токен (TTL 30 с). Фронтенд получает его
через `GET /api/auth/ws-token` и передаёт в query. Токен проверяется
в Redis и сразу удаляется (`GETDEL`). Невалидный токен → код **4001**.

Входящие сообщения:

```jsonc
{ "type": "audio_chunk", "data": "<base64 PCM 16kHz mono>" }
{ "type": "pause" }
{ "type": "resume" }
{ "type": "stop" }
```

Исходящие сообщения:

```jsonc
{ "type": "transcript_user", "text": "..." }
{ "type": "transcript_ai", "text": "..." }
{ "type": "audio_chunk", "data": "<base64 MP3>" }
{ "type": "audio_end" }              // конец одного предложения
{ "type": "session_ended" }
{ "type": "error", "message": "..." }
```

## Запуск

> Python 3.11–3.12 рекомендуется. На 3.14 у `asyncpg` может не быть wheel.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # заполнить LLM_* и ELEVENLABS_*
uvicorn main:app --host 127.0.0.1 --port 8000
```

`JWT_SECRET`, `DATABASE_URL`, `REDIS_URL` должны совпадать с `frontend/.env`.
PostgreSQL и Redis — общий `docker compose` из корня проекта.

Healthcheck: `GET http://localhost:8000/health`.

## Поток обработки

1. Клиент шлёт `audio_chunk` (PCM 16 kHz mono, base64).
2. **STT** (ElevenLabs Realtime): семантический коммит при завершающей
   пунктуации + короткой тишине; иначе VAD-фолбэк (0.65 с) → `transcript_user`.
3. **LLM** (OpenRouter, `gemini-2.5-flash-lite`) стримит токены; готовые
   предложения сразу уходят в TTS → `transcript_ai` (после полного ответа).
4. **TTS** (ElevenLabs flash, WebSocket на сессию) стримит MP3 по предложениям
   → `audio_chunk` + `audio_end` на каждое предложение.

Состояние в Redis:

```
session:{id}:status    -> active | paused | completed
session:{id}:messages  -> JSON-список (контекст LLM)
```

Первичная запись сообщений — PostgreSQL на RU (фоном, вне критического пути).
