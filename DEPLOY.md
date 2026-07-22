# Деплой: два сервера + автодеплой через GitHub Actions

Продакшен разнесён на два VPS:

- **RU-сервер** (Timeweb, `5.129.206.63`) — Caddy (HTTPS/WSS), Next.js,
  PostgreSQL. Пользователи ходят на https://5.129.206.63.nip.io.
- **DE-сервер** (`103.7.55.214`) — голосовой FastAPI backend (STT → LLM → TTS)
  и Redis (кэш сессий, ws-токены). Вынесен за рубеж: API ElevenLabs
  недоступен с российских IP.

Caddy на RU проксирует `/ws/*` на DE (порт 8000). Backend на DE пишет
в PostgreSQL на RU (порт 5432, файрвол — только IP DE). Redis — локально
на DE; frontend на RU подключается к нему по `103.7.55.214:6379` (пароль).

```mermaid
flowchart LR
    Browser[Браузер] -->|"HTTPS/WSS"| Caddy[RU: Caddy]
    Caddy -->|"/"| Frontend[RU: Next.js]
    Caddy -->|"/ws/*"| Backend[DE: FastAPI]
    Frontend --> PG[RU: PostgreSQL]
    Frontend -->|"6379"| Redis[DE: Redis]
    Backend -->|"5432"| PG
    Backend --> Redis
    Backend --> EL[ElevenLabs API]
    Backend --> OR[OpenRouter API]
```

---

## Проверки перед мержем (CI)

Каждый pull request запускает [.github/workflows/ci.yml](.github/workflows/ci.yml):
типы и ESLint во frontend, `pytest` в backend. Эти проверки стоит держать
обязательными в правилах защиты ветки `main` — она уезжает прямо в прод.

## Автодеплой (CD)

Каждый push в `main` запускает [.github/workflows/deploy.yml](.github/workflows/deploy.yml):

1. **build** — сборка Docker-образов `ai-trainer-frontend` и `ai-trainer-backend`
   на раннерах GitHub и push в Docker Hub (решает проблему медленного npm на VPS).
2. **deploy-de** — SSH на DE, `~/ai-trainer`.
3. **deploy-ru** — SSH на RU, `~/ai-salesperson-trainer` (плюс `git pull`).

Оба деплой-шага делают одно и то же: логинятся в Docker Hub, тянут **только
образ приложения** и проверяют, что контейнер поднялся именно на свежем образе.

> Почему так. Раньше серверы ходили в Docker Hub анонимно и тянули все образы
> сразу. Анонимные загрузки лимитированы: после нескольких выкаток подряд
> Hub ответил `429`, pull прервался вместе с образом приложения, `up -d`
> оставил работать старый контейнер — **а workflow отрапортовал успех**.
> Отсюда три правила: авторизация, pull только нужного образа (`caddy`,
> `postgres` и `redis` меняются раз в год, но тратят лимит) и явная сверка
> ID запущенного образа со свежим тегом. Молчаливо «успешный» деплой опаснее
> упавшего.

Для обновления продакшена достаточно `git push` — руками на серверы
ходить не нужно.

### Секреты репозитория (Settings → Secrets and variables → Actions)

| Секрет | Значение |
|---|---|
| `DOCKERHUB_USERNAME` | логин Docker Hub |
| `DOCKERHUB_TOKEN` | access token Docker Hub (Read & Write) |
| `RU_HOST`, `RU_SSH_PASSWORD` | IP и root-пароль RU-сервера |
| `DE_HOST`, `DE_SSH_PASSWORD` | IP и root-пароль DE-сервера |

SSH-аутентификация — по паролю (`appleboy/ssh-action`). Значения секретов
зашифрованы и маскируются в логах workflow.

---

## Разовая настройка серверов (уже выполнена)

### DE-сервер — голосовой backend + Redis

Всё живёт в отдельной папке `~/ai-trainer`, файлы других проектов не
затрагиваются. Порт 8000 защищён ws-токеном (без валидного токена
соединение закрывается с кодом 4001). Redis на 6379 — с `requirepass`.

```
~/ai-trainer/
├── docker-compose.yml   # копия deploy/docker-compose.de.yml
├── .env                 # DOCKERHUB_USER, REDIS_PASSWORD
└── backend.env          # секреты backend (см. backend/.env.production.example)
```

`backend.env` — по шаблону [backend/.env.production.example](backend/.env.production.example):
ключи `LLM_*` и `ELEVENLABS_*`; `DATABASE_URL` — публичный IP RU (Postgres);
`REDIS_URL` — локальный `redis:6379` в compose-сети. `JWT_SECRET` совпадает
с frontend на RU.

Запуск вручную (обычно не нужен — делает workflow):

```bash
cd ~/ai-trainer && docker compose pull && docker compose up -d
```

### RU-сервер — frontend, БД, Caddy

Репозиторий в `~/ai-salesperson-trainer`, стек — [docker-compose.prod.yml](docker-compose.prod.yml).

Файлы окружения:

- `.env` (корень) — по [.env.production.example](.env.production.example): `DOMAIN`,
  `ACME_EMAIL`, `POSTGRES_*`, `BACKEND_UPSTREAM=<DE_IP>:8000`,
  `DOCKERHUB_USER`.
- `frontend/.env` — по [frontend/.env.production.example](frontend/.env.production.example);
  `REDIS_URL` — на DE (`redis://:ПАРОЛЬ@103.7.55.214:6379`).

Согласованность значений:

| Значение | Где должно совпадать |
|---|---|
| `POSTGRES_PASSWORD` (`.env` RU) | `DATABASE_URL` в `frontend/.env` (RU) и `backend.env` (DE) |
| `REDIS_PASSWORD` (`~/ai-trainer/.env` DE) | `REDIS_URL` в `frontend/.env` (RU) и `backend.env` (DE) |
| `JWT_SECRET` | одинаковый в `frontend/.env` (RU) и `backend.env` (DE) |
| `DOMAIN` (`.env` RU) | `FASTAPI_WS_URL=wss://<domain>` в `frontend/.env` |

#### Файрвол: Postgres на RU только для DE

Порт 5432 опубликован наружу (нужен DE-backend), поэтому доступ
ограничен на уровне iptables (цепочка `DOCKER-USER` — обычный ufw
Docker обходит):

```bash
# правила добавляет скрипт (идемпотентно):
/usr/local/sbin/docker-user-firewall.sh
# автозапуск после ребута/рестарта Docker:
systemctl status docker-user-firewall.service
```

Скрипт дропает входящие на 5432 с любых адресов, кроме IP DE-сервера.
Трафик внутри compose-сети (frontend → postgres) не затрагивается.

---

## Проверка после деплоя

1. Workflow в GitHub Actions зелёный (вкладка Actions).
2. https://5.129.206.63.nip.io открывается, логин работает.
3. После входа открывается главная: приветствие, «Совет дня», статистика.
4. «Начать тренировку» → доступ к микрофону → фраза → голосовой ответ.
5. Логи backend на DE: `cd ~/ai-trainer && docker compose logs -f backend`
   (подключение к Postgres на RU, локальный Redis, тайминги STT/LLM/TTS).

## Наполнение данными

Все команды — на RU-сервере, из `~/ai-salesperson-trainer`. Миграции Prisma
накатываются автоматически при старте контейнера, наливать данные нужно руками.

```bash
# 1. Советы дня и мотивации — ОБЯЗАТЕЛЬНО, иначе блок на главной пуст
docker compose -f docker-compose.prod.yml exec frontend npm run seed:content

# 2. Пациенты и типы тренировки — ОБЯЗАТЕЛЬНО: в них лежат промпты,
#    без которых backend откажется начинать разговор
docker compose -f docker-compose.prod.yml exec frontend npm run seed:patients
docker compose -f docker-compose.prod.yml exec frontend npm run seed:training

# 3. Пользователь (email, пароль, имя, фамилия)
docker compose -f docker-compose.prod.yml exec frontend npm run create-user

# 4. Демо-аккаунт с историей разговоров и оценками — для показов
docker compose -f docker-compose.prod.yml exec frontend npm run seed:demo
```

`seed:demo` привязывает разговоры к пациенту из `seed:patients`, поэтому
порядок менять нельзя — без пациентов он завершится с ошибкой.

Промпты пациентов и типов тренировки живут в коде сидов (`frontend/scripts/`),
а не в базе: источник правды — репозиторий. Оба скрипта **перезаписывают**
промпты при каждом запуске, поэтому править их напрямую в БД бесполезно —
изменения потеряются на следующем сиде.

`seed:demo` печатает сгенерированный пароль один раз. Чтобы задать свой:
`... exec -e DEMO_PASSWORD=... frontend npm run seed:demo`. Скрипт идемпотентный
и трогает только демо-аккаунт.

> Разбора разговоров пока нет, поэтому у настоящих разговоров не будет оценок —
> блоки «Прогресс» и «средняя оценка» покажут пустое состояние. Демо-аккаунт
> существует именно для того, чтобы показывать заполненный интерфейс.

## Полезные команды

```bash
# RU: статус и логи
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml logs -f frontend

# DE: статус и логи backend + redis
cd ~/ai-trainer && docker compose ps && docker compose logs -f backend

# RU: остановить всё (данные сохраняются)
docker compose -f docker-compose.prod.yml down
```

---

## Чек-лист безопасности

- `.env`, `frontend/.env`, `backend.env` **не** коммитятся.
- `JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` — длинные случайные.
- 5432 на RU открыт **только** для IP DE-сервера (iptables `DOCKER-USER`).
- 6379 на DE — с `requirepass`; первичные данные в PostgreSQL на RU.
- Порт 8000 на DE открыт, но WebSocket требует одноразовый ws-токен;
  `/health` не раскрывает данных.
- Куки выставляются с флагом `Secure` (только HTTPS).
