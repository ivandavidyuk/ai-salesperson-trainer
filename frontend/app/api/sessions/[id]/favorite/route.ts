// PATCH /api/sessions/[id]/favorite
// Переключает отметку «избранное» у разговора.
// Тело: { isFavorite: boolean }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const isFavorite = body?.isFavorite;
    if (typeof isFavorite !== "boolean") {
      return NextResponse.json(
        { error: "Ожидается поле isFavorite (boolean)" },
        { status: 400 }
      );
    }

    // updateMany с userId в условии: так чужой разговор не переключить,
    // и не нужен отдельный запрос на проверку владельца.
    const result = await prisma.session.updateMany({
      where: { id: params.id, userId: user.sub },
      data: { isFavorite },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Разговор не найден" }, { status: 404 });
    }

    return NextResponse.json({ id: params.id, isFavorite });
  } catch (error) {
    console.error("Ошибка в /api/sessions/[id]/favorite:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
