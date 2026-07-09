# Голосовой ИИ-тренажёр по продажам

MVP: менеджер по продажам тренируется в голосовом разговоре с ИИ-клиентом «Тамара Михайловна».

**Стек:** Next.js (REST + UI) · FastAPI (WebSocket) · PostgreSQL · Redis · OpenRouter (LLM) · ElevenLabs (STT/TTS)

```
ai-salesperson-trainer/
├── frontend/               # Next.js 14
├── backend/                # FastAPI, голосовой пайплайн
├── deploy/                 # Caddyfile, compose для DE-сервера
├── docker-compose.yml      # PostgreSQL + Redis (локально)
├── docker-compose.prod.yml # RU-продакшен (Caddy, frontend, БД)
└── DEPLOY.md               # деплой и продакшен
```

**Продакшен:** https://5.129.206.63.nip.io

---

## Требования

- Node.js 18+, Python 3.11+, Docker Desktop
- Ключи [OpenRouter](https://openrouter.ai) (LLM) и [ElevenLabs](https://elevenlabs.io) (STT/TTS)
- VPN — ElevenLabs недоступен с российских IP (OpenRouter работает без VPN)

---

## Локальный запуск

Нужны три процесса: базы, frontend, backend.

### 1. Базы данных

```powershell
docker compose up -d
```

PostgreSQL — порт **5433**, Redis — **6379** (см. `frontend/.env.example`).

### 2. Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npx prisma migrate dev --name init
npx ts-node create-user.ts   # создать пользователя
npm run dev
```

→ http://localhost:3000

### 3. Backend

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # заполнить LLM_* и ELEVENLABS_*
uvicorn main:app --host 127.0.0.1 --port 8000
```

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` в `backend/.env` должны **совпадать** с `frontend/.env`.

### Повторный запуск

```powershell
docker compose up -d
# терминал 1: cd frontend && npm run dev
# терминал 2: cd backend && .\.venv\Scripts\Activate.ps1 && uvicorn main:app --host 127.0.0.1 --port 8000
```

---

## Переменные окружения

Шаблоны: `frontend/.env.example`, `backend/.env.example`.

| Frontend | Backend |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | те же + `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL` |
| `FASTAPI_WS_URL` (`ws://localhost:8000`) | `JWT_SECRET` (тот же) |

> На бесплатном тарифе ElevenLabs через API доступны только premade-голоса (не из Voice Library).

---

## Продакшен

Два VPS: **RU** (Caddy, frontend, PostgreSQL) + **DE** (голосовой backend, Redis).
Caddy проксирует `/ws/*` на DE; backend пишет в Postgres на RU, а Redis — локально
на DE (кэш сессий, ws-токены); frontend на RU ходит в тот же Redis на DE.

| | RU (`5.129.206.63`) | DE (`103.7.55.214`) |
|---|---|---|
| Сервисы | Caddy, Next.js, PostgreSQL | FastAPI backend, Redis |
| Путь | `~/ai-salesperson-trainer` | `~/ai-trainer` |

**Обновление:** `git push` в `main` → GitHub Actions собирает образы и деплоит на оба сервера.

Подробности — в [DEPLOY.md](./DEPLOY.md).

---

## API

| Метод | Маршрут | Описание |
|---|---|---|
| POST | `/api/auth/login` | вход |
| POST | `/api/auth/logout` | выход |
| GET | `/api/auth/me` | текущий пользователь |
| GET | `/api/auth/ws-token` | одноразовый токен для WebSocket (30 с) |
| POST | `/api/sessions/start` | создать сессию → `{ sessionId, wsUrl }` |
| POST | `/api/sessions/[id]/stop` | завершить сессию |
| GET | `/api/sessions/[id]/transcript` | транскрипт |

WebSocket: `ws://localhost:8000/ws/session/{id}?token=...` — голосовой пайплайн STT → LLM → TTS.
