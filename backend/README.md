# WebSocket-сервер — голосовой пайплайн (Этап 3)

Python FastAPI сервис, работающий рядом с Next.js приложением.
Реализует WebSocket-эндпоинт и голосовой пайплайн STT → LLM → TTS на
базе Yandex Cloud (SpeechKit + YandexGPT).

## Стек

- **FastAPI** + **uvicorn**, Python 3.11+
- **grpcio** + **yandexcloud** — Yandex SpeechKit STT (стриминг через gRPC)
- **httpx** — YandexGPT и SpeechKit TTS (REST)
- **redis** (async) — онлайн-состояние сессии
- **asyncpg** — сохранение сообщений в PostgreSQL
- **PyJWT** — проверка JWT (тот же секрет, что в Next.js)

## Структура

```
backend/
  main.py              # точка входа FastAPI, WS-эндпоинт и оркестрация
  services/
    stt.py             # Yandex SpeechKit STT (gRPC стриминг)
    tts.py             # Yandex SpeechKit TTS (REST)
    llm.py             # YandexGPT (REST) + системный промпт
    session.py         # состояние сессии (Redis) + история (PostgreSQL)
  core/
    config.py          # настройки из .env
    auth.py            # проверка JWT-токена
  requirements.txt
  .env.example
```

## WebSocket-протокол

```
WS /ws/session/{session_id}?token=<ws_token>
```

Авторизация — через одноразовый ws-токен (TTL 30 сек). Основной JWT лежит
в httpOnly cookie и недоступен из JS, поэтому фронтенд перед открытием WS
получает ws-токен через `GET /api/auth/ws-token` (Next.js) и передаёт его
в query-параметре. Токен одноразовый: сервер проверяет его в Redis и сразу
удаляет (`GETDEL`). Если токен не найден или истёк — соединение
закрывается с кодом **4001**.

Входящие сообщения от клиента:

```jsonc
{ "type": "audio_chunk", "data": "<base64 PCM 16kHz mono>" }
{ "type": "pause" }
{ "type": "resume" }
{ "type": "stop" }
```

Исходящие сообщения клиенту:

```jsonc
{ "type": "transcript_user", "text": "..." }
{ "type": "transcript_ai", "text": "..." }
{ "type": "audio_chunk", "data": "<base64 OGG/opus>" }
{ "type": "session_ended" }
{ "type": "error", "message": "..." }
```

## Запуск

> Требуется Python 3.11+. На очень новых версиях (3.14) у `grpcio`/`asyncpg`
> может не быть готовых wheel-пакетов — в этом случае используйте Python 3.12.

1. Создать виртуальное окружение и установить зависимости:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Заполнить `.env` на основе примера:

```powershell
Copy-Item .env.example .env
```

> `JWT_SECRET`, `DATABASE_URL` и `REDIS_URL` должны совпадать со значениями
> из `frontend/.env`. PostgreSQL и Redis поднимаются общим `docker compose`
> из корня проекта.

3. Запустить сервер:

```powershell
uvicorn main:app --host 0.0.0.0 --port 8000
```

Healthcheck: `GET http://localhost:8000/health`.

## Поток обработки

1. Клиент шлёт `audio_chunk` (PCM 16kHz mono, base64).
2. **STT** стримит аудио в SpeechKit; на финальной фразе → `transcript_user`
   и передаёт текст в LLM.
3. **LLM** (YandexGPT) с системным промптом роли клиента генерирует ответ →
   `transcript_ai`; сообщение сохраняется в PostgreSQL.
4. **TTS** озвучивает ответ (голос `alena`), аудио отправляется чанками
   `audio_chunk`.

Состояние сессии в Redis:

```
session:{id}:status    -> active | paused | completed
session:{id}:messages  -> JSON-список сообщений (контекст LLM)
```
