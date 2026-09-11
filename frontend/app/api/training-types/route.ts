// GET /api/training-types
// Типы тренировки для мастера настройки. Неактивные тоже отдаём:
// в мастере они видны с пометкой «скоро», но выбрать их нельзя.
// В демо на разговоры так же отдаём все — закрытые помечены `demoLocked`,
// иначе на витрине форматов остались бы пустые секции.
//
// Промпт наружу не отдаём — он нужен только backend'у при сборке
// системного промпта и в интерфейсе не показывается.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/access";
import { демоНаРазговоры } from "@/lib/demoAccess";
import { ДЕМО_ТИП } from "@/lib/demoScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const демо = await демоНаРазговоры(user.organizationId);

    const types = await prisma.trainingType.findMany({
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        group: true,
        isActive: true,
      },
    });

    return NextResponse.json(
      types.map((type) => ({
        ...type,
        demoLocked: демо && type.id !== ДЕМО_ТИП,
      }))
    );
  } catch (error) {
    console.error("Ошибка в /api/training-types:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
