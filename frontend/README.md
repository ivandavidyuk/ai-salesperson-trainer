# Frontend — Next.js (REST + UI)

Бэкенд авторизации и управления сессиями голосового ИИ-тренажёра.
Голосовой пайплайн (STT → LLM → TTS) — в отдельном FastAPI-сервисе
(`backend/`), сюда ходит только за ws-токеном и REST API.

## Стек

- **Next.js 14** (App Router) + **TypeScript**
- **PostgreSQL** + **Prisma** (ORM)
- **Redis** (whitelist JWT, одноразовые ws-токены)
- **bcryptjs** (хэширование паролей)
- **jose** (подпись/проверка JWT)

## Структура

```
/app/api
  /auth/login          POST  — вход, JWT в httpOnly cookie
  /auth/logout         POST  — выход, отзыв токена
  /auth/me             GET   — текущий пользователь
  /auth/ws-token       GET   — одноразовый токен для WebSocket (30 с)
  /sessions/start      POST  — создать сессию → { sessionId, wsUrl }
  /sessions/[id]/stop  POST  — завершить сессию
  /sessions/[id]/transcript GET — транскрипт сессии
/lib
  db.ts, redis.ts, auth.ts, voiceClient.ts
/prisma/schema.prisma
middleware.ts
create-user.ts         — скрипт создания пользователя
```

## Запуск

```powershell
npm install
Copy-Item .env.example .env
npx prisma migrate dev --name init
npx ts-node create-user.ts
npm run dev
```

→ http://localhost:3000

Переменные: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FASTAPI_WS_URL`
(`ws://localhost:8000` локально). Шаблон — `.env.example`.

На продакшене `REDIS_URL` указывает на DE-сервер (см. `.env.production.example`).

## Безопасность

- JWT только в **httpOnly cookie** (не в localStorage).
- Токены в **whitelist Redis**; логаут отзывает токен.
- `middleware.ts` проверяет подпись JWT; whitelist — в route handlers.
- ws-токен одноразовый, живёт 30 с, хранится в Redis.
