# Многостадийная сборка Next.js для продакшена.
# node:20-bookworm — openssl уже в образе (apt на VPS часто недоступен).

FROM node:20-bookworm AS base
WORKDIR /app
ENV NPM_CONFIG_FETCH_TIMEOUT=600000 \
    NPM_CONFIG_FETCH_RETRIES=5

# --- Установка зависимостей (devDeps нужны для next build / tailwind / typescript) ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- Сборка приложения ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ./node_modules/.bin/prisma generate && npm run build

# --- Запуск ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && npm run start"]
