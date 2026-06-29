Я разрабатываю MVP голосового ИИ-тренажёра по продажам.

Стек: Next.js 14 (App Router), TypeScript, PostgreSQL, Redis,
Prisma (ORM), bcryptjs (хэширование), jose (JWT).

Создай проект и его полную структуру:

/app
  /api
    /auth
      /login/route.ts
      /logout/route.ts
      /me/route.ts
    /sessions
      /start/route.ts
      /[id]
        /stop/route.ts
        /transcript/route.ts
/lib
  db.ts          # Prisma клиент
  redis.ts       # Redis клиент
  auth.ts        # JWT утилиты
/prisma
  schema.prisma
.env.example
create-user.ts   # скрипт создания пользователя

БД — три таблицы:

users: id String (uuid), email String (unique),
  passwordHash String, name String, createdAt DateTime

sessions: id String (uuid), userId String (FK→users),
  status Enum(active/paused/completed),
  startedAt DateTime, endedAt DateTime?

messages: id String (uuid), sessionId String (FK→sessions),
  role Enum(user/assistant), text String, createdAt DateTime

Что реализовать:

1. Prisma schema для всех трёх таблиц

2. POST /api/auth/login
   - принимает { email, password }
   - проверяет bcrypt хэш
   - возвращает JWT в httpOnly cookie
   - токен сохраняется в Redis

3. POST /api/auth/logout
   - удаляет токен из Redis
   - очищает cookie

4. GET /api/auth/me
   - проверяет JWT из cookie
   - возвращает { id, email, name }

5. POST /api/sessions/start
   - создаёт запись в sessions со статусом active
   - возвращает { sessionId, wsUrl }
   - wsUrl = ws://localhost:8000/ws/session/{sessionId}

6. POST /api/sessions/[id]/stop
   - меняет статус на completed
   - проставляет endedAt

7. GET /api/sessions/[id]/transcript
   - возвращает все messages сессии в порядке createdAt
   - формат: [{ role, text, createdAt }]

8. create-user.ts
   - запускается через npx ts-node create-user.ts
   - запрашивает email, password, name
   - создаёт пользователя с bcrypt хэшем пароля

9. middleware.ts
   - защищает все роуты кроме /login
   - редирект на /login если нет валидного токена

10. .env.example:
    DATABASE_URL=
    REDIS_URL=
    JWT_SECRET=
    JWT_EXPIRES_IN=24h
    FASTAPI_WS_URL=ws://localhost:8000

Требования:
- весь код на TypeScript
- JWT хранить в httpOnly cookie (не в localStorage)
- комментарии на русском языке в каждом файле
- обработка ошибок в каждом эндпоинте