// Утилиты для работы с JWT: создание, проверка подписи и хранение
// токенов в Redis (whitelist для возможности логаута).
//
// Важно: функции проверки/подписи JWT построены на библиотеке jose,
// которая работает и в Edge-окружении (middleware), и в Node-рантайме.
// Функции, обращающиеся к Redis, можно использовать только в Node-рантайме
// (то есть в route handlers, но НЕ в middleware).

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { ensureRedisConnected, redis } from "@/lib/redis";

// Имя httpOnly cookie, в которой хранится токен
export const TOKEN_COOKIE = "token";

// Полезная нагрузка нашего токена
export interface AuthTokenPayload extends JWTPayload {
  sub: string; // id пользователя
  email: string;
  name: string;
}

// Возвращает секрет для подписи JWT в виде байтов.
// Бросает ошибку, если переменная окружения не задана.
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Не задана переменная окружения JWT_SECRET");
  }
  return new TextEncoder().encode(secret);
}

// Преобразует строку срока жизни ("24h", "60m", "3600s", "7d")
// в количество секунд. Используется как TTL для записи в Redis.
function expiresInToSeconds(expiresIn: string): number {
  const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());
  if (!match) {
    // По умолчанию — 24 часа
    return 24 * 60 * 60;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 24 * 60 * 60;
    default:
      return 24 * 60 * 60;
  }
}

// Формирует ключ Redis для хранения активного токена
function redisTokenKey(token: string): string {
  return `auth:token:${token}`;
}

// Создаёт подписанный JWT для пользователя.
export async function signToken(payload: {
  userId: string;
  email: string;
  name: string;
}): Promise<string> {
  const expiresIn = process.env.JWT_EXPIRES_IN || "24h";

  const token = await new SignJWT({
    email: payload.email,
    name: payload.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());

  return token;
}

// Проверяет подпись и срок действия токена.
// Возвращает полезную нагрузку или null, если токен невалиден.
export async function verifyToken(
  token: string
): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    return payload as AuthTokenPayload;
  } catch {
    // Невалидная подпись, истёкший срок и т.п.
    return null;
  }
}

// Сохраняет токен в Redis (whitelist) с TTL, равным сроку жизни токена.
export async function storeToken(
  token: string,
  userId: string
): Promise<void> {
  await ensureRedisConnected();
  const ttl = expiresInToSeconds(process.env.JWT_EXPIRES_IN || "24h");
  await redis.set(redisTokenKey(token), userId, { EX: ttl });
}

// Проверяет, что токен присутствует в whitelist Redis (не был отозван).
export async function isTokenWhitelisted(token: string): Promise<boolean> {
  await ensureRedisConnected();
  const value = await redis.get(redisTokenKey(token));
  return value !== null;
}

// Удаляет токен из Redis (используется при логауте).
export async function revokeToken(token: string): Promise<void> {
  await ensureRedisConnected();
  await redis.del(redisTokenKey(token));
}

// Минимальный интерфейс запроса, из которого можно достать cookie.
// Подходит и для NextRequest, и для стандартного Request с обёрткой.
interface RequestWithCookies {
  cookies: { get(name: string): { value: string } | undefined };
}

// Достаёт текущего пользователя из запроса: проверяет подпись токена
// и его наличие в whitelist Redis. Возвращает payload или null.
// Используется в защищённых route handlers (Node-рантайм).
export async function getAuthUser(
  request: RequestWithCookies
): Promise<AuthTokenPayload | null> {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return null;
  }

  const whitelisted = await isTokenWhitelisted(token);
  if (!whitelisted) {
    return null;
  }

  return payload;
}
