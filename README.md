# Голосовой ИИ-тренажёр по продажам

MVP голосового тренажёра, где менеджер по продажам тренируется в разговоре
с ИИ-клиентом. Проект разбит на части:

```
ai-salesperson-trainer/
├── frontend/            # Next.js 14 (App Router): API + интерфейс
├── backend/             # Python FastAPI: WebSocket + голосовой пайплайн
├── development-stages/  # описания этапов разработки
└── docker-compose.yml   # PostgreSQL + Redis для локальной разработки
```

Готовы все три части: REST API и интерфейс (`frontend/`) и WebSocket-сервер
с голосовым пайплайном STT → LLM → TTS (`backend/`).

Для полноценной работы нужны **три процесса**: базы (Docker), Next.js
(`frontend`) и FastAPI WS-сервер (`backend`).

---

## Требования

- **Node.js** 18+ (проверено на 22.x) — для `frontend`
- **Python** 3.11+ (проверено на 3.14) — для `backend`
- **Docker Desktop** (для PostgreSQL и Redis)
- ключ **Yandex Cloud** — для реального голосового пайплайна

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
> **совпадать** с `frontend/.env`. Для реального голоса заполни `YANDEX_API_KEY`
> и `YANDEX_FOLDER_ID` — без них пайплайн отвечает `error` (каркас рабочий).
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

## API (этап 1)

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

- **Этап 1** — бэкенд: авторизация, сессии, транскрипт (`frontend/`) — **готово**
- **Этап 2** — интерфейс: `/login`, `/session`, `/transcript/[id]` (`frontend/`) — **готово**
- **Этап 3** — FastAPI WebSocket-сервер и голосовой пайплайн (`backend/`) — **готово**

Подробные описания — в папке `development-stages/`.
