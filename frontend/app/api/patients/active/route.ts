// GET /api/patients/active
// Пациент, с которым пойдёт следующая тренировка: имя, короткая подпись
// и анамнез для экрана звонка.
//
// Пока пациент один, поэтому берём первого активного. Когда появится
// «Настройка тренировки», выбор будет приходить из неё.

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

    const patient = await prisma.patient.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, anamnesis: true },
    });

    if (!patient) {
      return NextResponse.json({ error: "Пациент не найден" }, { status: 404 });
    }

    return NextResponse.json(patient);
  } catch (error) {
    console.error("Ошибка в /api/patients/active:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
