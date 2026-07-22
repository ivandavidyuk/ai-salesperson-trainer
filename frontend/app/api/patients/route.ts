// GET /api/patients
// Список пациентов для мастера настройки тренировки.
// Неактивных тоже отдаём: в мастере они видны с пометкой «скоро»,
// но выбрать их нельзя.

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

    const patients = await prisma.patient.findMany({
      // Доступные вперёд, дальше по порядку создания — как в сиде
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        anamnesis: true,
        difficulty: true,
        isActive: true,
      },
    });

    return NextResponse.json(patients);
  } catch (error) {
    console.error("Ошибка в /api/patients:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
