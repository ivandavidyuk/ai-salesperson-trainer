# ИИ-тренажёр по продажам — Backend (Этап 1)

Бэкенд голосового ИИ-тренажёра по продажам на Next.js 14 (App Router) с авторизацией
через JWT в httpOnly cookie.

## Стек

- **Next.js 14** (App Router) + **TypeScript**
- **PostgreSQL** + **Prisma** (ORM)
- **Redis** (whitelist активных JWT-токенов)
- **bcryptjs** (хэширование паролей)
- **jose** (подпись/проверка JWT)

## Структура

```
/app/api
  /auth/login          POST  — вход, выдаёт JWT в httpOnly cookie
  /auth/logout         POST  — выход, отзывает токен
  /auth/me             GET   — данные текущего пользователя
  /sessions/start      POST  — создать сессию, вернуть { sessionId, wsUrl }
  /sessions/[id]/stop  POST  — завершить сессию
  /sessions/[id]/transcript GET — транскрипт сессии
/lib
  db.ts      — Prisma-клиент
  redis.ts   — Redis-клиент
  auth.ts    — JWT-утилиты
/prisma/schema.prisma  — модели users / sessions / messages
middleware.ts          — защита роутов
create-user.ts         — скрипт создания пользователя
```

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Скопировать переменные окружения и заполнить их:

```bash
cp .env.example .env
```

3. Применить схему БД:

```bash
npx prisma migrate dev --name init
```

4. Создать пользователя:

```bash
npx ts-node create-user.ts
```

5. Запустить сервер разработки:

```bash
npm run dev
```

## Заметки по безопасности

- JWT хранится только в **httpOnly cookie** (не в localStorage).
- Токены добавляются в **whitelist в Redis**; логаут отзывает токен.
- `middleware.ts` проверяет подпись токена для всех роутов, кроме `/login`
  и `/api/auth/login`; полная проверка whitelist выполняется в route handlers.
