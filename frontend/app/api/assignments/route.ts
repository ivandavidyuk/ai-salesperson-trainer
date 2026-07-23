// GET  /api/assignments — список заданий для раздела «Задания».
//   менеджеру — полученные им, руководителю — выданные им.
// POST /api/assignments — создать задание (только руководитель).
//
// Приоритетные сверху, дальше по сроку: то, что горит, должно быть первым.

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole, requireHead } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const isHead = user.role === UserRole.head;

    const rows = await prisma.assignment.findMany({
      // Руководитель видит выданные им, менеджер — полученные
      where: isHead
        ? { createdById: user.id, status: "active" }
        : { userId: user.id, status: "active" },
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
            // Разбор пациента — только руководителю
            character: isHead,
            objections: isHead,
            decisionMaker: isHead,
            approach: isHead,
          },
        },
        trainingType: { select: { id: true, title: true, isActive: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        user: { select: { id: true, firstName: true, lastName: true, avatarUpdatedAt: true } },
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
        // Кому назначено — нужно только на странице руководителя
        assignee: isHead
          ? {
              id: row.user.id,
              name: `${row.user.firstName} ${row.user.lastName[0] ?? ""}.`.trim(),
              avatarUpdatedAt: row.user.avatarUpdatedAt?.toISOString() ?? null,
            }
          : null,
      }))
    );
  } catch (error) {
    console.error("Ошибка в GET /api/assignments:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

interface CreateBody {
  userId?: string;
  patientId?: string;
  trainingTypeId?: string;
  title?: string;
  comment?: string;
  dueAt?: string | null;
  isPriority?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }

    let body: CreateBody;
    try {
      body = (await request.json()) as CreateBody;
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const title = body.title?.trim() ?? "";
    const comment = body.comment?.trim() ?? "";
    if (!title) {
      return NextResponse.json(
        { error: "Укажите название задания" },
        { status: 400 }
      );
    }

    // Назначать можно только менеджеру: задание другому руководителю
    // сломало бы смысл раздела
    const target = body.userId
      ? await prisma.user.findUnique({
          where: { id: body.userId },
          select: { id: true, role: true },
        })
      : null;
    if (!target || target.role !== UserRole.manager) {
      return NextResponse.json(
        { error: "Выберите менеджера" },
        { status: 400 }
      );
    }

    const patient = body.patientId
      ? await prisma.patient.findUnique({
          where: { id: body.patientId },
          select: { id: true, isActive: true },
        })
      : null;
    if (!patient?.isActive) {
      return NextResponse.json(
        { error: "Этот пациент пока недоступен" },
        { status: 400 }
      );
    }

    const type = body.trainingTypeId
      ? await prisma.trainingType.findUnique({
          where: { id: body.trainingTypeId },
          select: { id: true, isActive: true },
        })
      : null;
    if (!type?.isActive) {
      return NextResponse.json(
        { error: "Этот тип тренировки пока недоступен" },
        { status: 400 }
      );
    }

    // Срок хранится концом дня: «до 24 июля» значит весь день 24-го
    let dueAt: Date | null = null;
    if (body.dueAt) {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Некорректный срок" }, { status: 400 });
      }
      parsed.setHours(23, 59, 59, 0);
      dueAt = parsed;
    }

    const created = await prisma.assignment.create({
      data: {
        userId: target.id,
        createdById: head.id,
        patientId: patient.id,
        trainingTypeId: type.id,
        title,
        comment,
        dueAt,
        isPriority: Boolean(body.isPriority),
      },
      select: { id: true },
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    console.error("Ошибка в POST /api/assignments:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
