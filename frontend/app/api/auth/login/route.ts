// POST /api/auth/login
// Принимает { email, password }, проверяет bcrypt-хэш пароля,
// выдаёт JWT в httpOnly cookie и сохраняет токен в Redis (whitelist).

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signToken, storeToken, TOKEN_COOKIE } from "@/lib/auth";

// Этот роут работает в Node-рантайме (нужны bcrypt, Prisma и Redis)
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Разбираем тело запроса
    const body = await request.json().catch(() => null);

    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json(
        { error: "Не переданы email и пароль" },
        { status: 400 }
      );
    }

    const { email, password } = body;

    // Ищем пользователя по email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Не уточняем, что именно неверно — это безопаснее
    if (!user) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // Сравниваем переданный пароль с хэшем из БД
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // Создаём JWT и сохраняем его в Redis (whitelist)
    const token = await signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    await storeToken(token, user.id);

    // Возвращаем ответ и кладём токен в httpOnly cookie
    const response = NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });

    response.cookies.set({
      name: TOKEN_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Ошибка в /api/auth/login:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
