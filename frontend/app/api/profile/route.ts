// PATCH /api/profile
// Личные данные пользователя: имя, фамилия, e-mail, должность, клиника.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";

interface ProfileBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  jobTitle?: string;
  clinic?: string;
}

// Пустая строка в необязательном поле означает «очистить», поэтому
// отличаем её от «поле не прислали»
function optional(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    let body: ProfileBody;
    try {
      body = (await request.json()) as ProfileBody;
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();
    const email = body.email?.trim().toLowerCase();

    // Имя и фамилия обязательны: без них интерфейс останется без подписи
    if (firstName !== undefined && firstName === "") {
      return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
    }
    if (lastName !== undefined && lastName === "") {
      return NextResponse.json({ error: "Укажите фамилию" }, { status: 400 });
    }
    if (email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: "Некорректный e-mail" },
        { status: 400 }
      );
    }

    try {
      const updated = await prisma.user.update({
        where: { id: user.sub },
        data: {
          ...(firstName !== undefined ? { firstName } : {}),
          ...(lastName !== undefined ? { lastName } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(optional(body.jobTitle) !== undefined
            ? { jobTitle: optional(body.jobTitle) }
            : {}),
          ...(optional(body.clinic) !== undefined
            ? { clinic: optional(body.clinic) }
            : {}),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          clinic: true,
        },
      });

      return NextResponse.json(updated);
    } catch (error) {
      // P2002 — нарушен уникальный индекс: такой e-mail уже занят.
      // Ловим явно, иначе пользователь увидит «внутреннюю ошибку».
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return NextResponse.json(
          { error: "Этот e-mail уже занят" },
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("Ошибка в /api/profile:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
