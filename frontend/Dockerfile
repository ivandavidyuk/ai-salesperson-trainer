# Многостадийная сборка Next.js для продакшена.
# Используем полный node:20-bookworm (не slim): openssl уже в образе.
# На некоторых VPS (Timeweb и др.) исходящий доступ к deb.debian.org
# заблокирован — apt-get в Dockerfile там не работает.

FROM node:20-bookworm AS base
WORKDIR /app

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
