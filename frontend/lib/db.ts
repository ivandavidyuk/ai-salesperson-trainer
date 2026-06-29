// Единый экземпляр Prisma-клиента для всего приложения.
// В режиме разработки Next.js часто перезагружает модули, поэтому
// сохраняем клиент в global, чтобы не плодить лишние подключения к БД.

import { PrismaClient } from "@prisma/client";

// Расширяем тип global, чтобы хранить кешированный клиент
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Используем существующий клиент или создаём новый
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

// В разработке сохраняем клиент в global, в продакшене — нет
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
