// GET /api/users/managers
// Менеджеры, которым руководитель может назначить тренировку.
// Только для роли head: список сотрудников не должен быть виден всем.

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }

    const managers = await prisma.user.findMany({
      where: { role: UserRole.manager },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        avatarUpdatedAt: true,
      },
    });

    return NextResponse.json(
      managers.map((manager) => ({
        id: manager.id,
        name: `${manager.firstName} ${manager.lastName}`.trim(),
        jobTitle: manager.jobTitle ?? "Менеджер по продажам",
        avatarUpdatedAt: manager.avatarUpdatedAt?.toISOString() ?? null,
      }))
    );
  } catch (error) {
    console.error("Ошибка в /api/users/managers:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
