// GET /api/patients
// Список пациентов для мастера настройки тренировки.
// Неактивных тоже отдаём: в мастере они видны с пометкой «скоро»,
// но выбрать их нельзя. По той же причине список не режется в демо
// на разговоры — закрытые там помечаются `demoLocked`.

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/access";
import { демоНаРазговоры } from "@/lib/demoAccess";
import { ДЕМО_КЛИЕНТЫ } from "@/lib/demoScope";
import { сНаложеннымСлучаем, случайДляОрганизации } from "@/lib/patientCase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Разбор пациента — только руководителю. Это не косметика: подсказка
    // «как выиграть клиента» в руках менеджера обесценивает тренировку.
    const isHead = user.role === UserRole.head;

    // Демо на разговоры: открыта тройка, остальные видны и погашены
    const демо = await демоНаРазговоры(user.organizationId);

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
        character: isHead,
        objections: isHead,
        decisionMaker: isHead,
        approach: isHead,
        // Случай под клинику пользователя перекрывает видимые поля:
        // анамнез и карточка зависят от отрасли, а личность — нет
        cases: случайДляОрганизации(user.organizationId),
      },
    });

    const строки = patients.map((patient) => ({
      ...сНаложеннымСлучаем(patient),
      demoLocked: демо && !ДЕМО_КЛИЕНТЫ.includes(patient.name),
    }));

    // Закрытые демо-доступом — вниз, к неготовым. Иначе открытая тройка
    // разъезжается по списку из двадцати одного (Тамара первая, Станислав
    // одиннадцатый, Джамшид тринадцатый), и в мастере видно только Тамару:
    // человек листает девять погашенных карточек, прежде чем найдёт вторую
    // доступную, — или решает, что клиент в демо один.
    // Сортировка устойчивая, поэтому внутри групп порядок сида сохраняется.
    if (демо) {
      строки.sort((a, b) => Number(a.demoLocked) - Number(b.demoLocked));
    }

    return NextResponse.json(строки);
  } catch (error) {
    console.error("Ошибка в /api/patients:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
