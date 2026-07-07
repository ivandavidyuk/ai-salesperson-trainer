# Голосовой ИИ-тренажёр по продажам

MVP голосового тренажёра, где менеджер по продажам тренируется в разговоре
с ИИ-клиентом. Проект разбит на части:

```
ai-salesperson-trainer/
├── frontend/              # Next.js 14 (App Router): API + интерфейс
├── backend/               # Python FastAPI: WebSocket + голосовой пайплайн
├── deploy/                # Caddyfile для продакшена
├── development-stages/    # описания этапов разработки
├── docker-compose.yml     # PostgreSQL + Redis для локальной разработки
├── docker-compose.prod.yml # полный продакшен-стек (5 контейнеров)
└── DEPLOY.md              # подробная инструкция по деплою и обновлению
```

Готовы все три части: REST API и интерфейс (`frontend/`) и WebSocket-сервер
с голосовым пайплайном STT → LLM → TTS (`backend/`). Браузер захватывает
микрофон (PCM 16 кГц) и проигрывает голосовой ответ ИИ — полный голосовой
диалог работает от начала до конца.

Для полноценной работы нужны **три процесса**: базы (Docker), Next.js
(`frontend`) и FastAPI WS-сервер (`backend`).

---

## Требования

- **Node.js** 18+ (проверено на 22.x) — для `frontend`
- **Python** 3.11+ (проверено на 3.14) — для `backend`
- **Docker Desktop** (для PostgreSQL и Redis)
- ключ **OpenRouter** (LLM) и ключ **ElevenLabs** (STT + TTS) — для реального
  голосового пайплайна
- **VPN** на машине разработчика — API ElevenLabs недоступен с российских IP
  (OpenRouter работает и без VPN)

---

## Повторный запуск (продолжение разработки)

Если проект уже настроен (зависимости установлены, миграции применены),
для возобновления работы нужно запустить три процесса.

**1. Запустить Docker Desktop** (если не стартует автоматически при входе в систему).

**2. Поднять контейнеры БД** — из корня проекта:

```powershell
docker compose up -d
```

> Команда идемпотентна: если контейнеры уже работают, ничего не сломается.
> Данные сохраняются в volume между перезапусками.

**3. Запустить frontend** (Next.js) — в отдельном терминале из папки `frontend`:

```powershell
cd frontend
npm run dev
```

**4. Запустить backend** (WS-сервер) — в ещё одном терминале из папки `backend`:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --host 127.0.0.1 --port 8000
```

> Фронтенд — на http://localhost:3000, WS-сервер — на http://localhost:8000.
> Бэкенд можно не запускать, если голосовой пайплайн сейчас не нужен.

## Быстрый старт

### 1. Поднять базы данных (PostgreSQL + Redis)

Из **корня проекта**:

```powershell
docker compose up -d
```

Проверить, что контейнеры запущены и healthy:

```powershell
docker compose ps
```

> PostgreSQL слушает порт **5433** на хосте (5432 занят локально установленным
> Postgres), Redis — **6379**. Эти значения уже прописаны в `frontend/.env`.

### 2. Настроить и запустить frontend

```powershell
cd frontend
npm install
```

Создать файл `.env` (если ещё нет) на основе примера и при необходимости
поправить значения:

```powershell
Copy-Item .env.example .env
```

Применить схему БД (создаст таблицы users / sessions / messages):

```powershell
npx prisma migrate dev --name init
```

### 3. Создать пользователя

Интерактивный скрипт (спросит email, пароль, имя):

```powershell
npx ts-node create-user.ts
```

### 4. Запустить сервер разработки

```powershell
npm run dev
```

Приложение: **http://localhost:3000**
Без авторизации любой маршрут редиректит на `/login`.

### 5. Настроить и запустить backend (WS-сервер)

В отдельном терминале, из папки `backend`:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --host 127.0.0.1 --port 8000
```

> В `backend/.env` значения `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` должны
> **совпадать** с `frontend/.env`. Для реального голоса заполни `LLM_API_KEY`
> (OpenRouter), `ELEVENLABS_API_KEY` и `ELEVENLABS_VOICE_ID` — без них
> пайплайн отвечает `error` (каркас рабочий).
> Healthcheck: `GET http://localhost:8000/health`.

---

### Чего делать НЕ нужно (уже сделано однажды)

- `npm install` — зависимости установлены.
- `npx prisma migrate dev` — таблицы созданы. Запускать **только если изменился**
  `prisma/schema.prisma`.
- `npx ts-node create-user.ts` — тестовый пользователь уже есть:
  **`test@example.com` / `password123`**.
- `py -m venv .venv` + `pip install` в `backend` — окружение уже создано.
  Запускать установку заново только если изменился `requirements.txt`.

> Если Prisma ругается на подключение к БД — проверь, что Postgres `healthy`
> в `docker compose ps`, и что в текущей сессии терминала нет «висящих»
> переменных окружения (`$env:DATABASE_URL` и т.п.), перебивающих `.env`.

---

## Переменные окружения (`frontend/.env`)

| Переменная | Назначение | Значение по умолчанию |
|---|---|---|
| `DATABASE_URL` | строка подключения к PostgreSQL (Prisma) | `postgresql://postgres:postgres@localhost:5433/ai_trainer?schema=public` |
| `REDIS_URL` | строка подключения к Redis | `redis://localhost:6379` |
| `JWT_SECRET` | секрет для подписи JWT (тот же используется в FastAPI) | — |
| `JWT_EXPIRES_IN` | срок жизни токена | `24h` |
| `FASTAPI_WS_URL` | базовый адрес WebSocket-сервера | `ws://localhost:8000` |

> Файл `.env` в `.gitignore` и на GitHub не попадает.

---

## Переменные окружения (`backend/.env`)

| Переменная | Назначение | Значение по умолчанию |
|---|---|---|
| `LLM_API_KEY` | ключ OpenRouter (или другого OpenAI-совместимого провайдера) | — |
| `LLM_BASE_URL` | базовый URL LLM-провайдера | `https://openrouter.ai/api/v1` |
| `LLM_MODEL` | ID модели (формат OpenRouter) | `google/gemini-2.5-flash` |
| `ELEVENLABS_API_KEY` | ключ ElevenLabs (STT + TTS) | — |
| `ELEVENLABS_VOICE_ID` | ID голоса клиента (из ElevenLabs dashboard) | — |
| `ELEVENLABS_TTS_MODEL` | модель TTS | `eleven_flash_v2_5` |
| `DATABASE_URL` | строка подключения к PostgreSQL (должна совпадать с `frontend/.env`) | — |
| `REDIS_URL` | строка подключения к Redis (та же, что в `frontend/.env`) | — |
| `JWT_SECRET` | секрет для проверки JWT (тот же, что в `frontend/.env`) | — |

> На **бесплатном тарифе ElevenLabs** через API работают только стандартные
> (premade) голоса — голоса из Voice Library вернут `402 Payment Required`.
> `ELEVENLABS_TTS_MODEL=eleven_v3` включает эмоции и audio-теги ([sighs],
> [hesitant]), но заметно медленнее `eleven_flash_v2_5`.

### Голосовой пайплайн (детали)

- **STT** (ElevenLabs Scribe v2 Realtime, WebSocket): PCM 16 кГц mono,
  язык ru. Конец фразы определяет VAD — пауза `EOU_SILENCE_SECS = 1.0` с
  в `services/stt.py`.
- **LLM** (OpenRouter, OpenAI-совместимый REST): роль клиента
  «Тамара Михайловна» (промпт в `services/llm.py`).
- **TTS** (ElevenLabs REST): голос из `ELEVENLABS_VOICE_ID`, формат MP3
  44.1 кГц 64 кбит/с.

Замеренные задержки (Windows + VPN, июль 2026): LLM `gemini-2.5-flash`
~0.8 с, `gpt-4o-mini` ~1.2 с; TTS `eleven_flash_v2_5` ~0.6 с.

---

## Продакшен

Приложение развёрнуто на **VPS Timeweb Cloud** (Ubuntu 22.04, 2 vCPU / 4 ГБ RAM).

> **Внимание: продакшен ещё на старом стеке (Yandex SpeechKit + YandexGPT).**
> Код в репозитории уже переведён на OpenRouter + ElevenLabs, но API ElevenLabs
> **недоступен с российских IP** — для деплоя нового стека голосовой backend
> нужно перенести на зарубежный VPS (например, в Германии), а RU-сервер
> оставить для frontend/БД с проксированием `/ws` на зарубежный backend.
> План описан в `.cursor/plans/`, деплой — отдельный этап.

| Параметр | Значение |
|---|---|
| **URL** | https://5.129.206.63.nip.io |
| **Публичный IPv4** | `5.129.206.63` |
| **Домен** | `5.129.206.63.nip.io` (сервис [nip.io](https://nip.io), отдельный домен не нужен) |
| **HTTPS / WSS** | Caddy + Let's Encrypt (автоматически) |
| **Репозиторий** | https://github.com/ivandavidyuk/ai-salesperson-trainer |
| **Путь на сервере** | `~/ai-salesperson-trainer` |

### Стек на сервере

Пять контейнеров через `docker-compose.prod.yml`:

- **caddy** — единая точка входа (80/443), проксирует `/` → frontend и `/ws` → backend
- **frontend** — Next.js (REST API + интерфейс, миграции Prisma при старте)
- **backend** — FastAPI WebSocket (STT → LLM → TTS)
- **postgres** — PostgreSQL 16 (данные только в volume, наружу не открыт)
- **redis** — Redis 7 (JWT whitelist, ws-токены)

### SSH и управление

```bash
ssh root@5.129.206.63
cd ~/ai-salesperson-trainer

# статус контейнеров
docker compose -f docker-compose.prod.yml ps

# логи (frontend / backend / caddy)
docker compose -f docker-compose.prod.yml logs -f backend --tail 50

# перезапуск сервиса
docker compose -f docker-compose.prod.yml restart frontend
```

### Переменные окружения на сервере

Три файла (не в git, создаются из `*.example`):

| Файл | Назначение |
|---|---|
| `./.env` | `DOMAIN`, `ACME_EMAIL`, `POSTGRES_*` |
| `frontend/.env` | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FASTAPI_WS_URL` |
| `backend/.env` | `LLM_*` (OpenRouter), `ELEVENLABS_*`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` |

Критично, чтобы совпадали:

```env
# корневой .env
DOMAIN=5.129.206.63.nip.io

# frontend/.env
FASTAPI_WS_URL=wss://5.129.206.63.nip.io
```

`JWT_SECRET` и пароль PostgreSQL — одинаковые в `frontend/.env` и `backend/.env`.

### Создание пользователей для тестировщиков

```bash
docker compose -f docker-compose.prod.yml exec frontend npx ts-node create-user.ts
```

Скрипт спросит email, пароль и имя. Каждому тестировщику — отдельный аккаунт.

### Обновление после изменений в коде

На VPS **сборка frontend через `npm ci` ненадёжна** (медленная сеть, таймауты, неполная
установка пакетов). Backend обычно собирается на сервере нормально.

**Backend** (на сервере):

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build backend
```

**Frontend** (рекомендуется — сборка локально или в CI, доставка через Docker Hub):

```powershell
# на Windows (Docker Desktop)
cd frontend
docker build -t ai-salesperson-trainer-frontend:latest .
docker tag ai-salesperson-trainer-frontend:latest <DOCKERHUB_USER>/ai-trainer-frontend:latest
docker push <DOCKERHUB_USER>/ai-trainer-frontend:latest
```

```bash
# на сервере
docker pull <DOCKERHUB_USER>/ai-trainer-frontend:latest
docker tag <DOCKERHUB_USER>/ai-trainer-frontend:latest ai-salesperson-trainer-frontend:latest
cd ~/ai-salesperson-trainer
docker compose -f docker-compose.prod.yml up -d --no-build
```

Подробнее — в [DEPLOY.md](./DEPLOY.md).

### Известные ограничения VPS Timeweb

- **Исходящий доступ к `deb.debian.org` заблокирован** — в Dockerfile frontend нет `apt-get`,
  используется полный образ `node:20-bookworm`.
- **Медленный npm на сервере** — frontend лучше не собирать на VPS.
- **Блокировки у некоторых российских провайдеров (ТСПУ)** — отдельные IP могут быть
  недоступны с части сетей. Предыдущий IP `109.73.192.18` был заменён на `5.129.206.63`
  по рекомендации поддержки Timeweb. Если у тестировщика сайт или WebSocket не открываются,
  попросить проверить консоль браузера (F12) и логи backend во время сессии.

### Рекомендации для тестировщиков

- Браузер: **Chrome** или **Edge** (Safari на iOS может работать нестабильно).
- Обязательно **HTTPS** — без него браузер не даст доступ к микрофону.
- При первом разговоре — **разрешить микрофон**; лучше использовать **наушники**,
  чтобы STT не подхватывал голос ИИ из колонок.

---

## API

| Метод | Маршрут | Описание |
|---|---|---|
| POST | `/api/auth/login` | вход, выдаёт JWT в httpOnly cookie |
| POST | `/api/auth/logout` | выход, отзывает токен в Redis |
| GET | `/api/auth/me` | данные текущего пользователя |
| GET | `/api/auth/ws-token` | одноразовый токен (TTL 30с) для WebSocket |
| POST | `/api/sessions/start` | создать сессию → `{ sessionId, wsUrl }` |
| POST | `/api/sessions/[id]/stop` | завершить сессию |
| GET | `/api/sessions/[id]/transcript` | транскрипт сессии |

### Быстрая проверка через curl

```bash
# Вход (сохранит cookie в cookies.txt)
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"test@example.com\",\"password\":\"password123\"}"

# Текущий пользователь
curl -b cookies.txt http://localhost:3000/api/auth/me

# Старт сессии
curl -b cookies.txt -X POST http://localhost:3000/api/sessions/start
```

---

## Остановка

```powershell
# остановить dev-сервер Next.js и uvicorn: Ctrl+C в их терминалах

# остановить базы (данные сохранятся в volume)
docker compose down

# остановить и удалить данные БД
docker compose down -v
```

---

## Этапы разработки

| Этап | Описание | Статус |
|---|---|---|
| 1 | REST API: авторизация, сессии, транскрипт (`frontend/`) | готово |
| 2 | Интерфейс: `/login`, `/session`, `/transcript/[id]` | готово |
| 3 | FastAPI WebSocket и голосовой пайплайн (`backend/`) | готово |
| 4 | Голос в браузере: микрофон + воспроизведение (`voiceClient.ts`) | готово |
| 5 | Продакшен-деплой на Timeweb Cloud | готово |

Подробные описания этапов 1–4 — в папке `development-stages/`.
Инструкция по деплою и обновлению — в [DEPLOY.md](./DEPLOY.md).
