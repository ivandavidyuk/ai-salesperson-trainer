// POST /api/sessions/[id]/stop
// Завершает сессию: ставит статус completed и проставляет endedAt.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Проверяем авторизацию
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const sessionId = params.id;

    // Убеждаемся, что сессия существует и принадлежит пользователю
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== user.sub) {
      return NextResponse.json(
        { error: "Сессия не найдена" },
        { status: 404 }
      );
    }

    // Меняем статус на completed и проставляем время завершения
    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        endedAt: new Date(),
      },
    });

    return NextResponse.json({
      sessionId: updated.id,
      status: updated.status,
      endedAt: updated.endedAt,
    });
  } catch (error) {
    console.error("Ошибка в /api/sessions/[id]/stop:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
