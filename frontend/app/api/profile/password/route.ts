// POST /api/profile/password
// Смена пароля: сверяем текущий, пишем новый хеш, перевыпускаем токен.
//
// Перевыпуск важен: старый токен отзывается (иначе им можно было бы
// пользоваться после смены пароля), но пользователя при этом не выкидывает
// со страницы — он сразу получает новый в cookie.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  getAuthUser,
  revokeToken,
  signToken,
  storeToken,
  TOKEN_COOKIE,
} from "@/lib/auth";

export const runtime = "nodejs";

const MIN_LENGTH = 8;

interface PasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    let body: PasswordBody;
    try {
      body = (await request.json()) as PasswordBody;
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const currentPassword = body.currentPassword ?? "";
    const newPassword = body.newPassword ?? "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Заполните оба поля" },
        { status: 400 }
      );
    }
    if (newPassword.length < MIN_LENGTH) {
      return NextResponse.json(
        { error: `Пароль короче ${MIN_LENGTH} символов` },
        { status: 400 }
      );
    }
    if (!/[а-яёa-z]/i.test(newPassword) || !/\d/.test(newPassword)) {
      return NextResponse.json(
        { error: "Пароль должен содержать буквы и цифры" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.sub },
      select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      return NextResponse.json(
        { error: "Текущий пароль неверный" },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    // Старый токен больше не должен работать
    const oldToken = request.cookies.get(TOKEN_COOKIE)?.value;
    if (oldToken) await revokeToken(oldToken);

    const token = await signToken({
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    await storeToken(token, user.id);

    const response = NextResponse.json({ ok: true });
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
    console.error("Ошибка в /api/profile/password:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
