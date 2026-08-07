# Сборка Next.js для продакшена (одна стадия — без COPY node_modules между слоями).
# node:20-bookworm: openssl уже есть, apt на VPS часто недоступен.

FROM node:20-bookworm
WORKDIR /app

ENV NPM_CONFIG_FETCH_TIMEOUT=600000 \
    NPM_CONFIG_FETCH_RETRIES=5

COPY package.json package-lock.json ./

# npm ci на медленных VPS иногда ставит пакеты неполно — prisma доустанавливаем явно
RUN npm ci --include=dev \
    && npm install prisma@5.18.0 --no-save \
    && test -x node_modules/.bin/prisma

COPY . .

RUN node_modules/.bin/prisma generate \
    && npm run build

ENV NODE_ENV=production
EXPOSE 3000
# Пересборка промптов между миграциями и стартом: наши правки механизма
# и личностей доезжают до клиентов сами, без кнопки и без обращений к модели.
#
# Скобки не случайны. Миграция — жёсткий заслон: не прошла, приложение
# подниматься не должно. Пересборка — мягкая: она освежает данные, и её сбой
# оставит промпты прежними, что несравнимо лучше лежащего сервиса.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && { npm run rebuild:prompts || echo 'ПЕРЕСБОРКА ПРОМПТОВ НЕ УДАЛАСЬ — промпты остались прежними'; } && npm run start"]
