# Голосовой ИИ-тренажёр по продажам

MVP: менеджер по продажам тренируется в голосовом разговоре с ИИ-клиентом
«Тамарой Михайловной» — говорит в микрофон, слышит ответ, может перебивать.
После разговора остаётся расшифровка, а на главной — статистика и прогресс.

**Стек:** Next.js 14 (REST + UI) · FastAPI (WebSocket) · PostgreSQL · Redis ·
OpenRouter (LLM) · ElevenLabs (STT/TTS)

```
ai-salesperson-trainer/
├── frontend/                 # Next.js 14: интерфейс, REST API, БД
├── backend/                  # FastAPI: голосовой пайплайн STT → LLM → TTS
├── deploy/                   # Caddyfile и compose для DE-сервера
├── .github/workflows/        # ci.yml (проверки) и deploy.yml (автодеплой)
├── docker-compose.yml        # PostgreSQL + Redis (локально)
├── docker-compose.prod.yml   # RU-продакшен (Caddy, frontend, PostgreSQL)
├── CLAUDE.md                 # шпаргалка по проекту
└── DEPLOY.md                 # деплой и продакшен
```

**Продакшен:** https://5.129.206.63.nip.io

---

## Требования

- Node.js 18+, Python 3.11–3.12, Docker Desktop
- Ключи [OpenRouter](https://openrouter.ai) (LLM) и [ElevenLabs](https://elevenlabs.io) (STT/TTS)
- VPN — ElevenLabs недоступен с российских IP (OpenRouter работает без VPN)

---

## Локальный запуск

Нужны три процесса: базы, frontend, backend.

### 1. Базы данных

```powershell
docker compose up -d
```

PostgreSQL — порт **5433**, Redis — **6379**.

### 2. Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npx prisma migrate deploy     # применить миграции
npm run seed:content          # советы дня и мотивации (иначе блок пустой)
npm run seed:patients         # пациенты и их промпты
npm run seed:training         # типы тренировки и их промпты
npm run seed:achievements     # достижения
npm run create-user           # создать пользователя (email, пароль, имя, фамилия)
npm run dev
```

→ http://localhost:3000

Чтобы посмотреть главную с заполненными данными, не проводя разговоров:

```powershell
npm run seed:demo             # демо-аккаунт с историей и оценками
```

Порядок важен: `seed:demo` привязывает разговоры к пациенту из
`seed:patients` и без него завершится с ошибкой.

### 3. Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # заполнить LLM_* и ELEVENLABS_*
uvicorn main:app --host 127.0.0.1 --port 8000
```

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` в `backend/.env` должны **совпадать**
с `frontend/.env`.

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
| `JWT_SECRET`, `JWT_EXPIRES_IN` | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL` |
| `FASTAPI_WS_URL` (`ws://localhost:8000`) | `JWT_SECRET` (тот же), `BARGE_IN_ENABLED` |

> На бесплатном тарифе ElevenLabs через API доступны только premade-голоса.

---

## Экраны

| Путь | Что это |
|---|---|
| `/` | главная: приветствие, запуск тренировки, совет дня, статистика, прогресс, история |
| `/login` | вход |
| `/session` | экран голосового звонка |
| `/transcript/[id]` | расшифровка разговора и разбор |
| `/tasks` | задания от руководителя |
| `/patients` | библиотека ИИ-пациентов |
| `/training` | выбор формата тренировки |
| `/achievements` | игровые достижения |
| `/profile` | профиль: фото, личные данные, смена пароля |

## API

| Метод | Маршрут | Описание |
|---|---|---|
| POST | `/api/auth/login` | вход |
| POST | `/api/auth/logout` | выход |
| GET | `/api/auth/me` | текущий пользователь |
| GET | `/api/auth/ws-token` | одноразовый токен для WebSocket (30 с) |
| GET | `/api/home` | все данные главной одним запросом |
| POST | `/api/sessions/start` | создать сессию → `{ sessionId, wsUrl }` |
| GET | `/api/sessions` | список разговоров |
| POST | `/api/sessions/[id]/stop` | завершить сессию |
| PATCH | `/api/sessions/[id]/favorite` | избранное |
| GET | `/api/sessions/[id]/transcript` | расшифровка и разбор |
| GET | `/api/patients` | список пациентов для мастера и раздела «Пациенты» |
| GET | `/api/training-types` | типы тренировки |
| GET | `/api/assignments` | активные задания от руководителя |
| GET | `/api/assignments/count` | счётчик заданий для бейджа в меню |
| GET | `/api/achievements` | достижения с отметкой полученных |
| PATCH | `/api/profile` | личные данные |
| PUT/DELETE | `/api/profile/avatar` | загрузка и удаление фото |
| POST | `/api/profile/password` | смена пароля |
| GET | `/api/users/[id]/avatar` | фото пользователя картинкой |

WebSocket: `ws://localhost:8000/ws/session/{id}?token=...` — стриминговый
пайплайн STT → LLM → TTS (см. [backend/README.md](backend/README.md)).

---

## База данных

Схема — [frontend/prisma/schema.prisma](frontend/prisma/schema.prisma).

| Модель | Назначение |
|---|---|
| `User` | менеджер или руководитель: email, хэш пароля, имя, роль, должность, клиника, фото профиля |
| `Patient` | персонаж, которого играет ИИ: анамнез, сложность, промпт роли |
| `TrainingType` | формат тренировки: полный разговор, этап сделки, спецнавык + промпт этапа |
| `Session` | один разговор: пациент, тип, длительность, избранное |
| `Message` | реплика внутри разговора |
| `SessionReview` | разбор разговора: общая оценка, 4 оценки по этапам сделки, сильная сторона и точка роста |
| `Assignment` | задание от руководителя: пара «тип + пациент», комментарий, срок |
| `Achievement` / `UserAchievement` | игровые бейджи и кто их получил |
| `DailyContent` | «Совет дня» и «Мотивация» |

Системный промпт для ИИ backend собирает из `Patient.prompt` и
`TrainingType.prompt` — обе части наливаются сидами, источник правды
в `frontend/scripts/`.

«Совет дня» и «Мотивация» меняются раз в сутки: элемент выбирается по индексу
дня (`день % количество`), поэтому фоновых задач не нужно — достаточно налить
список в таблицу через `npm run seed:content`.

> Блоки «Статистика» и «Прогресс» своих таблиц не имеют: считаются агрегатами
> по `Session` и `SessionReview` (дельта — среднее за текущую неделю минус
> за прошлую).

**Разбора разговоров пока нет** — `SessionReview` заполняется только сидом,
поэтому у реальных разговоров оценок не будет, и блоки покажут пустое состояние.

---

## Проверки

Гоняются в CI на каждый pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

```powershell
cd frontend
npx tsc --noEmit      # типы
npm run lint          # ESLint

cd ..\backend
pip install -r requirements.txt -r requirements-dev.txt
pytest tests/         # тесты классификатора поддакиваний
```

---

## Продакшен

Два VPS: **RU** (Caddy, frontend, PostgreSQL) + **DE** (голосовой backend, Redis).
Caddy проксирует `/ws/*` на DE; backend пишет в Postgres на RU, а Redis — локально
на DE. Вынос backend за рубеж нужен потому, что ElevenLabs не отвечает на
российские IP.

**Обновление:** `git push` в `main` → GitHub Actions собирает образы и деплоит
на оба сервера. Подробности — в [DEPLOY.md](./DEPLOY.md).
