// GET /api/patients/active
// Пациент, с которым пойдёт следующая тренировка: имя, короткая подпись
// и анамнез для экрана звонка.
//
// Пока пациент один, поэтому берём первого активного. Когда появится
// «Настройка тренировки», выбор будет приходить из неё.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/access";
import { сНаложеннымСлучаем, случайДляОрганизации } from "@/lib/patientCase";
import { медицинскаяОтрасль } from "@/lib/industry";
import { словаОтрасли } from "@/lib/industryWords";
import { составОтрасли } from "@/scripts/patients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Не getAuthUser: нужна организация, чтобы взять случай под её отрасль
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Тот же состав по отрасли, что в списке: клиент по умолчанию не должен
    // оказаться персонажем другой отрасли, а у набора в работе — клиентом
    // без случая
    const организация = user.organizationId
      ? await prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: { industry: true },
        })
      : null;
    const отрасль = организация?.industry ?? "";
    const соСлучаем =
      медицинскаяОтрасль(отрасль) || !user.organizationId
        ? {}
        : { cases: { some: { organizationId: user.organizationId } } };

    const patient = await prisma.patient.findFirst({
      where: {
        isActive: true,
        name: { in: составОтрасли(отрасль).map((p) => p.name) },
        ...соСлучаем,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        anamnesis: true,
        cases: случайДляОрганизации(user.organizationId),
      },
    });

    if (!patient) {
      return NextResponse.json(
        { error: `${словаОтрасли(отрасль).Клиент} не найден` },
        { status: 404 }
      );
    }

    return NextResponse.json(сНаложеннымСлучаем(patient));
  } catch (error) {
    console.error("Ошибка в /api/patients/active:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
