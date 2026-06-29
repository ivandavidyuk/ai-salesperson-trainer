// GET /api/auth/me
// Проверяет JWT из cookie (подпись + наличие в whitelist Redis)
// и возвращает данные текущего пользователя { id, email, name }.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  isTokenWhitelisted,
  TOKEN_COOKIE,
  verifyToken,
} from "@/lib/auth";

export const runtime = "nodejs";
// Роут читает cookie запроса — рендерится только динамически
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Получаем токен из httpOnly cookie
    const token = request.cookies.get(TOKEN_COOKIE)?.value;
    if (!token) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверяем подпись и срок действия токена
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Невалидный токен" },
        { status: 401 }
      );
    }

    // Проверяем, что токен не был отозван (есть в Redis)
    const whitelisted = await isTokenWhitelisted(token);
    if (!whitelisted) {
      return NextResponse.json(
        { error: "Токен отозван" },
        { status: 401 }
      );
    }

    // Загружаем актуальные данные пользователя из БД
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 401 }
      );
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Ошибка в /api/auth/me:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
