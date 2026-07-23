// GET /api/sessions/[id]/transcript
// Всё, что нужно странице расшифровки, одним запросом: шапка разговора,
// реплики в хронологическом порядке и разбор (если он уже есть).

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/access";

export const runtime = "nodejs";
// Роут читает cookie запроса — рендерится только динамически
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id: params.id },
      select: {
        userId: true,
        topic: true,
        startedAt: true,
        durationSec: true,
        patient: { select: { name: true } },
        review: {
          select: {
            overallScore: true,
            contactScore: true,
            iceBreakerScore: true,
            needsScore: true,
            objectionsScore: true,
            strength: true,
            growthPoint: true,
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, text: true, createdAt: true },
        },
      },
    });

    // Свой разговор видит менеджер, любой — руководитель: со страницы
    // статистики он открывает разборы подчинённых, ради этого она и нужна.
    // Чужой разговор не отличаем от несуществующего — по ответу нельзя
    // узнать, что сессия с таким id вообще есть.
    const canRead =
      session &&
      (session.userId === user.id || user.role === UserRole.head);
    if (!session || !canRead) {
      return NextResponse.json({ error: "Разговор не найден" }, { status: 404 });
    }

    // Инициалы в аватарах реплик — того, кто вёл разговор, а не того,
    // кто читает: у руководителя иначе стояли бы его собственные
    const manager = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { firstName: true, lastName: true },
    });

    return NextResponse.json({
      session: {
        startedAt: session.startedAt.toISOString(),
        durationSec: session.durationSec,
        topic: session.topic,
        patientName: session.patient?.name ?? null,
      },
      manager: {
        firstName: manager?.firstName ?? "",
        lastName: manager?.lastName ?? "",
      },
      messages: session.messages.map((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
      })),
      review: session.review,
    });
  } catch (error) {
    console.error("Ошибка в /api/sessions/[id]/transcript:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
