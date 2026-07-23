// GET /api/assignments
// Активные задания текущего пользователя для раздела «Задания».
// Приоритетные сверху, дальше по сроку: то, что горит, должно быть первым.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const rows = await prisma.assignment.findMany({
      where: { userId: user.sub, status: "active" },
      orderBy: [
        { isPriority: "desc" },
        // Задания без срока — в конце: nulls last не поддержан напрямую,
        // но asc в Postgres и так ставит NULL последними
        { dueAt: "asc" },
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        title: true,
        comment: true,
        dueAt: true,
        isPriority: true,
        patient: {
          select: {
            id: true,
            name: true,
            description: true,
            anamnesis: true,
            difficulty: true,
            isActive: true,
          },
        },
        trainingType: { select: { id: true, title: true, isActive: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        comment: row.comment,
        dueAt: row.dueAt?.toISOString() ?? null,
        isPriority: row.isPriority,
        patient: row.patient,
        trainingType: row.trainingType,
        author: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      }))
    );
  } catch (error) {
    console.error("Ошибка в /api/assignments:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
