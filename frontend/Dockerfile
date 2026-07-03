# Многостадийная сборка Next.js для продакшена.
# node:20-bookworm — openssl уже в образе (apt на VPS часто недоступен).

FROM node:20-bookworm AS base
WORKDIR /app
# На медленных VPS увеличиваем таймауты npm
ENV NPM_CONFIG_FETCH_TIMEOUT=600000 \
    NPM_CONFIG_FETCH_RETRIES=5

# --- Установка зависимостей ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Сборка приложения ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# npm run — использует prisma из node_modules, npx может снова лезть в registry
RUN npm run prisma:generate && npm run build

# --- Запуск ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && npm run start"]
