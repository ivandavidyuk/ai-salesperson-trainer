// POST /api/auth/logout
// Удаляет токен из Redis (отзыв) и очищает httpOnly cookie.

import { NextRequest, NextResponse } from "next/server";
import { revokeToken, TOKEN_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Достаём токен из cookie
    const token = request.cookies.get(TOKEN_COOKIE)?.value;

    // Если токен есть — удаляем его из whitelist в Redis
    if (token) {
      await revokeToken(token);
    }

    // Очищаем cookie у клиента
    const response = NextResponse.json({ success: true });
    response.cookies.set({
      name: TOKEN_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Ошибка в /api/auth/logout:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
