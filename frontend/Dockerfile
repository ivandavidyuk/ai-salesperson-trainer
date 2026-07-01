# Многостадийная сборка Next.js для продакшена.

FROM node:20-bookworm-slim AS base
WORKDIR /app
# openssl нужен Prisma для работы движка запросов
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# --- Установка зависимостей ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Сборка приложения ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# --- Запуск ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# При старте: применяем миграции БД, затем поднимаем сервер Next.js
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
