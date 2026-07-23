# Frontend — Next.js (интерфейс + REST API)

Интерфейс тренажёра, авторизация и работа с базой. Голосовой пайплайн
(STT → LLM → TTS) живёт в отдельном FastAPI-сервисе (`../backend`), сюда он
ходит только за ws-токеном; сам разговор идёт по WebSocket напрямую.

## Стек

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **PostgreSQL** + **Prisma** (ORM)
- **Redis** (whitelist JWT, одноразовые ws-токены)
- **bcryptjs** (хэширование паролей), **jose** (подпись/проверка JWT)

## Структура

```
app/
  page.tsx                 главная (приветствие, старт, статистика, прогресс)
  login/                   вход
  session/                 экран голосового звонка
  transcript/[id]/         расшифровка разговора
  tasks|patients|training|achievements|profile/   заглушки разделов
  components/              компоненты дизайн-системы и блоки страниц
  api/
    auth/login|logout|me|ws-token
    home                   GET  — все данные главной одним запросом
    sessions               GET  — список разговоров
    sessions/start         POST — создать сессию → { sessionId, wsUrl }
    sessions/[id]/stop     POST — завершить (пишет длительность)
    sessions/[id]/favorite PATCH — избранное
    sessions/[id]/transcript GET
lib/
  auth.ts       JWT, whitelist в Redis, ws-токены
  db.ts         единый Prisma-клиент
  redis.ts      подключение к Redis
  home.ts       сбор данных главной: статистика, прогресс, ежедневный контент
  format.ts     длительность, даты разговоров, инициалы, приветствие
  voiceClient.ts захват микрофона и воспроизведение ответа (только браузер)
scripts/
  create-user.ts   интерактивное создание пользователя
  seed-content.ts  советы дня и мотивации (продовый контент)
  seed-patients.ts пациенты, их анамнез и промпты
  seed-training-types.ts типы тренировки и их промпты
  seed-achievements.ts достижения (кто что получил — в seed-demo)
  seed-demo.ts     демо-аккаунт с историей разговоров и разборами
prisma/schema.prisma
middleware.ts     защита всех маршрутов кроме /login
```

## Запуск

```powershell
npm install
Copy-Item .env.example .env
npx prisma migrate deploy
npm run seed:content
npm run seed:patients
npm run seed:training
npm run seed:achievements
npm run create-user
npm run dev
```

→ http://localhost:3000

| Команда | Что делает |
|---|---|
| `npm run dev` | дев-сервер |
| `npm run build` | продакшен-сборка |
| `npm run lint` | ESLint |
| `npm run create-user` | создать пользователя |
| `npm run seed:content` | налить советы дня и мотивации |
| `npm run seed:patients` | налить пациентов и их промпты |
| `npm run seed:training` | налить типы тренировки и их промпты |
| `npm run seed:achievements` | налить достижения |
| `npm run seed:demo` | демо-аккаунт с заполненной главной |
| `npm run prisma:migrate` | создать миграцию |

Переменные: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
`FASTAPI_WS_URL` (`ws://localhost:8000` локально). Шаблон — `.env.example`.
На продакшене `REDIS_URL` указывает на DE-сервер (см. `.env.production.example`).

## Оформление

Дизайн-система podhod.tech, направление 1A «Спокойная клиника». Токены —
в [tailwind.config.ts](tailwind.config.ts), названы по роли (`brand`, `ink`,
`surface`, `line`, `danger`, `good`, `warn`), а не по цвету. Новые экраны
собираются из них: подобранных на глаз hex-значений в разметке быть не должно.

Верстаем **только светлый десктоп** — мобильная версия и тёмная тема будут
сделаны позже, разом для всех экранов.

## Безопасность

- JWT только в **httpOnly cookie** (не в localStorage).
- Токены в **whitelist Redis**; логаут отзывает токен.
- `middleware.ts` проверяет подпись JWT; whitelist — в route handlers
  (Redis недоступен в Edge-рантайме).
- ws-токен одноразовый, живёт 30 с, хранится в Redis.
- Роуты, меняющие данные, проверяют владельца прямо в условии запроса —
  чужую сессию не изменить.
