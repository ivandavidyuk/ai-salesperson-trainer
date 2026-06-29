// Middleware защиты роутов.
// Защищает все страницы и API, кроме /login и публичного эндпоинта логина.
// Если валидного JWT нет — для страниц делает редирект на /login,
// для API возвращает 401.
//
// Важно: middleware выполняется в Edge-рантайме, поэтому здесь нельзя
// использовать Node-зависимости (Prisma, node-redis). Проверяем только
// подпись и срок действия токена через jose (она edge-совместима).
// Полную проверку whitelist в Redis делают сами route handlers.

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Имя cookie с токеном (дублируем константу, чтобы не тянуть Node-модули)
const TOKEN_COOKIE = "token";

// Пути, доступные без авторизации
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

// Возвращает секрет для проверки JWT
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Не задана переменная окружения JWT_SECRET");
  }
  return new TextEncoder().encode(secret);
}

// Проверяет подпись и срок действия токена
async function isTokenValid(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Пропускаем публичные пути без проверки
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + "/")
  );
  if (isPublic) {
    return NextResponse.next();
  }

  // Достаём токен и проверяем его
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const valid = token ? await isTokenValid(token) : false;

  if (valid) {
    return NextResponse.next();
  }

  // Невалидный токен: для API — 401 JSON, для страниц — редирект на /login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

// Конфиг matcher: применяем middleware ко всем путям,
// кроме статики Next.js и служебных файлов.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
