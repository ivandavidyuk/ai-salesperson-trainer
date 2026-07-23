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

    // Меняем статус на completed, проставляем время завершения и
    // длительность (её показывает главная и по ней считается средняя;
    // хранить отдельно дешевле, чем каждый раз вычитать даты в агрегатах)
    const endedAt = new Date();
    const durationSec = Math.max(
      0,
      Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
    );

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        endedAt,
        durationSec,
      },
    });

    // Разговор по заданию закрывает это задание. updateMany с userId
    // в условии: чужое задание не должно закрыться даже теоретически.
    if (session.assignmentId) {
      await prisma.assignment.updateMany({
        where: { id: session.assignmentId, userId: user.sub, status: "active" },
        data: { status: "done", completedAt: endedAt },
      });
    }

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
