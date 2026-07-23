// PUT/DELETE /api/profile/avatar
// Загрузка и удаление фото профиля. Клиент присылает уже сжатый JPEG,
// но проверки типа и размера всё равно серверные: полагаться на то,
// что запрос пришёл из нашего интерфейса, нельзя.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    let file: File | null = null;
    try {
      const form = await request.formData();
      const value = form.get("file");
      if (value instanceof File) file = value;
    } catch {
      // не multipart или битое тело — разбираем ниже как отсутствие файла
    }

    if (!file) {
      return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Подойдёт только JPG или PNG" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Файл больше 5 МБ" },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Файл пустой" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const avatarUpdatedAt = new Date();

    await prisma.user.update({
      where: { id: user.sub },
      data: { avatar: bytes, avatarMime: file.type, avatarUpdatedAt },
    });

    return NextResponse.json({
      avatarUpdatedAt: avatarUpdatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Ошибка в PUT /api/profile/avatar:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: user.sub },
      data: { avatar: null, avatarMime: null, avatarUpdatedAt: null },
    });

    return NextResponse.json({ avatarUpdatedAt: null });
  } catch (error) {
    console.error("Ошибка в DELETE /api/profile/avatar:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
