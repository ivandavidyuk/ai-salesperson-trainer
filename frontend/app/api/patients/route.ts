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
import { демоКлиенты } from "@/lib/demoScope";
import { медицинскаяОтрасль } from "@/lib/industry";
import { сНаложеннымСлучаем, случайДляОрганизации } from "@/lib/patientCase";
import { составОтрасли } from "@/scripts/patients";

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

    // Состав по отрасли организации: у клиники свои персонажи, у офиса
    // продаж свои (scripts/patients, поле industries). Без организации — клиника
    const организация = user.organizationId
      ? await prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: { industry: true },
        })
      : null;
    const отрасль = организация?.industry ?? "";
    const клиника = медицинскаяОтрасль(отрасль);

    const patients = await prisma.patient.findMany({
      where: { name: { in: составОтрасли(отрасль).map((p) => p.name) } },
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

    // Тройка демо своя у каждой отрасли (lib/demoScope.ts)
    const открытыВДемо = демоКлиенты(отрасль);
    const строки = patients.map((patient) => ({
      ...сНаложеннымСлучаем(patient),
      // У набора, который ещё пишется, случай есть не у всех: такой клиент
      // виден с пометкой «скоро», как неактивный, — выбрать его нельзя,
      // и старт разговора не отвечает отказом. У клиник случаи собирает
      // генерация, и до неё список остаётся прежним
      isActive:
        patient.isActive &&
        (клиника || ((patient as { cases?: unknown[] }).cases?.length ?? 0) > 0),
      demoLocked: демо && !открытыВДемо.includes(patient.name),
    }));

    // Закрытые демо-доступом — вниз, к неготовым. Иначе открытая тройка
    // разъезжается по списку из двадцати одного (при первой тройке Тамара
    // шла первой, Станислав одиннадцатым, Джамшид тринадцатым), и в мастере
    // видно только Тамару:
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
