// GET /api/users/[id]/avatar
// Отдаёт фото профиля картинкой. По id, а не «своё»: аватарки нужны и
// в чужих карточках — например, руководителя в задании.
//
// Кеш вечный и это безопасно: клиент дописывает к URL ?v=avatarUpdatedAt,
// поэтому после смены фото адрес другой.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Картинки видны только внутри приложения
    const viewer = await getAuthUser(request);
    if (!viewer) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { avatar: true, avatarMime: true },
    });

    if (!user?.avatar) {
      return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
    }

    return new NextResponse(Buffer.from(user.avatar), {
      headers: {
        "Content-Type": user.avatarMime ?? "image/jpeg",
        "Content-Length": String(user.avatar.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Ошибка в /api/users/[id]/avatar:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
