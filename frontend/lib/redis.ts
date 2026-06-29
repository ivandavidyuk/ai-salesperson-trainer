// Подключение к Redis. Используется для хранения активных JWT-токенов
// (whitelist), чтобы можно было инвалидировать токен при логауте.

import { createClient, type RedisClientType } from "redis";

// Кешируем клиент в global, чтобы избежать множественных подключений
// при горячей перезагрузке в режиме разработки.
const globalForRedis = globalThis as unknown as {
  redis: RedisClientType | undefined;
};

// Создаём (или переиспользуем) клиент Redis
export const redis: RedisClientType =
  globalForRedis.redis ??
  createClient({
    url: process.env.REDIS_URL,
  });

// Логируем ошибки подключения, чтобы они не падали молча
redis.on("error", (err) => {
  console.error("Ошибка Redis:", err);
});

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

// Гарантирует, что соединение с Redis установлено перед использованием.
// Безопасно вызывать многократно — повторного подключения не происходит.
export async function ensureRedisConnected(): Promise<void> {
  if (!redis.isOpen) {
    await redis.connect();
  }
}
