# Голосовой ИИ-тренажёр по продажам

MVP голосового тренажёра, где менеджер по продажам тренируется в разговоре
с ИИ-клиентом. Проект разбит на части:

```
ai-salesperson-trainer/
├── frontend/            # Next.js 14 (App Router): API + интерфейс
├── backend/             # Python FastAPI: WebSocket + голосовой пайплайн (этап 3)
├── development-stages/  # описания этапов разработки
└── docker-compose.yml   # PostgreSQL + Redis для локальной разработки
```

На текущем этапе готов **бэкенд во `frontend/`**: авторизация (JWT в httpOnly
cookie), управление сессиями и транскриптом.

---

## Требования

- **Node.js** 18+ (проверено на 22.x)
- **Docker Desktop** (для PostgreSQL и Redis)

---

## Повторный запуск (продолжение разработки)

Если проект уже настроен (зависимости установлены, миграции применены),
для возобновления работы достаточно двух шагов.

**1. Запустить Docker Desktop** (если не стартует автоматически при входе в систему).

**2. Поднять контейнеры БД** — из корня проекта:

```powershell
docker compose up -d
```

> Команда идемпотентна: если контейнеры уже работают, ничего не сломается.
> Данные сохраняются в volume между перезапусками.

**3. Запустить dev-сервер** — из папки `frontend`:

```powershell
cd frontend
npm run dev
```

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

---

### Чего делать НЕ нужно (уже сделано однажды)

- `npm install` — зависимости установлены.
- `npx prisma migrate dev` — таблицы созданы. Запускать **только если изменился**
  `prisma/schema.prisma`.
- `npx ts-node create-user.ts` — тестовый пользователь уже есть:
  **`test@example.com` / `password123`**.

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
# остановить dev-сервер: Ctrl+C в его терминале

# остановить базы (данные сохранятся в volume)
docker compose down

# остановить и удалить данные БД
docker compose down -v
```

---

## Этапы разработки

- **Этап 1** — бэкенд: авторизация, сессии, транскрипт (`frontend/`) — **готово**
- **Этап 2** — интерфейс: страницы `/login`, `/session`, `/transcript/[id]`
- **Этап 3** — FastAPI WebSocket-сервер и голосовой пайплайн (`backend/`)

Подробные описания — в папке `development-stages/`.
