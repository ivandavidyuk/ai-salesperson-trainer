// GET  /api/assignments — списки заданий для раздела «Задания»:
//   активные и выполненные за последние 30 дней.
//   Менеджеру — полученные им, руководителю — выданные им.
// POST /api/assignments — создать задание (только руководитель).
//
// Приоритетные сверху, дальше по сроку: то, что горит, должно быть первым.
// Выполненные — от свежих к старым: «что закрыли на этой неделе».

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole, requireHead } from "@/lib/access";
import {
  началоОкнаВыполненных,
  разобратьЗадание,
  type ПоляЗадания,
} from "@/lib/assignments";
import { сНаложеннымСлучаем, случайДляОрганизации } from "@/lib/patientCase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Короткое имя для плашки «Кому»: «Алексей М.» */
const короткоеИмя = (firstName: string, lastName: string) =>
  `${firstName} ${lastName[0] ?? ""}.`.trim();

export async function GET(request: NextRequest) {
  try {
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const isHead = user.role === UserRole.head;
    // Руководитель видит выданные им, менеджер — полученные
    const чьи = isHead ? { createdById: user.id } : { userId: user.id };

    const активные = await prisma.assignment.findMany({
      where: { ...чьи, status: "active" },
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
            cases: случайДляОрганизации(user.organizationId),
          },
        },
        trainingType: { select: { id: true, title: true, isActive: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        user: { select: { id: true, firstName: true, lastName: true, avatarUpdatedAt: true } },
        // Начатое задание удаляют с другим предупреждением: разговор
        // у менеджера останется, а задание из списка пропадёт
        _count: { select: { sessions: true } },
      },
    });

    const выполненные = await prisma.assignment.findMany({
      where: {
        ...чьи,
        status: "done",
        completedAt: { gte: началоОкнаВыполненных() },
      },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        title: true,
        completedAt: true,
        patient: { select: { id: true, name: true } },
        trainingType: { select: { id: true, title: true } },
        user: { select: { id: true, firstName: true, lastName: true, avatarUpdatedAt: true } },
        // Разговор, которым закрыли: из выполненного задания ведём
        // к расшифровке — это ответ на «и как он его выполнил»
        sessions: {
          where: { status: "completed" },
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            id: true,
            durationSec: true,
            review: { select: { overallScore: true } },
          },
        },
      },
    });

    return NextResponse.json({
      active: активные.map((row) => ({
        id: row.id,
        title: row.title,
        comment: row.comment,
        dueAt: row.dueAt?.toISOString() ?? null,
        isPriority: row.isPriority,
        patient: сНаложеннымСлучаем(row.patient),
        trainingType: row.trainingType,
        author: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
        started: row._count.sessions > 0,
        // Кому назначено — нужно только на странице руководителя
        assignee: isHead
          ? {
              id: row.user.id,
              name: короткоеИмя(row.user.firstName, row.user.lastName),
              avatarUpdatedAt: row.user.avatarUpdatedAt?.toISOString() ?? null,
            }
          : null,
      })),
      done: выполненные.map((row) => {
        const разговор = row.sessions[0] ?? null;
        return {
          id: row.id,
          title: row.title,
          completedAt: row.completedAt?.toISOString() ?? null,
          patient: { id: row.patient.id, name: row.patient.name },
          trainingType: row.trainingType,
          assignee: isHead
            ? {
                id: row.user.id,
                name: короткоеИмя(row.user.firstName, row.user.lastName),
                avatarUpdatedAt: row.user.avatarUpdatedAt?.toISOString() ?? null,
              }
            : null,
          conversation: разговор
            ? {
                id: разговор.id,
                durationSec: разговор.durationSec,
                score: разговор.review?.overallScore ?? null,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error("Ошибка в GET /api/assignments:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
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

    let body: ПоляЗадания;
    try {
      body = (await request.json()) as ПоляЗадания;
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const итог = await разобратьЗадание(body, {
      всеОбязательны: true,
      организация: head.organizationId,
    });
    if (!итог.ok) {
      return NextResponse.json({ error: итог.ошибка }, { status: 400 });
    }
    const { userId, patientId, trainingTypeId, title, comment, dueAt, isPriority } =
      итог.поля;

    const created = await prisma.assignment.create({
      data: {
        userId: userId!,
        createdById: head.id,
        patientId: patientId!,
        trainingTypeId: trainingTypeId!,
        title: title!,
        comment: comment ?? "",
        dueAt: dueAt ?? null,
        isPriority: Boolean(isPriority),
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
