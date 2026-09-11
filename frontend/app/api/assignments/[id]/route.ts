// PATCH  /api/assignments/[id] — поправить задание.
// DELETE /api/assignments/[id] — удалить задание.
//
// Оба действия — только автору задания и только пока оно активно.
// Выполненное не трогаем: оно уже часть истории менеджера, и менять
// задним числом условие пройденной тренировки нечестно.
//
// Владелец проверяется прямо в условии запроса (`createdById` в where),
// а не отдельным чтением: чужое задание не должно находиться даже
// теоретически.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { разобратьЗадание, type ПоляЗадания } from "@/lib/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
      всеОбязательны: false,
      организация: head.organizationId,
    });
    if (!итог.ok) {
      return NextResponse.json({ error: итог.ошибка }, { status: 400 });
    }
    if (Object.keys(итог.поля).length === 0) {
      return NextResponse.json({ error: "Нечего менять" }, { status: 400 });
    }

    const { count } = await prisma.assignment.updateMany({
      where: { id: params.id, createdById: head.id, status: "active" },
      data: итог.поля,
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "Задание не найдено или уже выполнено" },
        { status: 404 }
      );
    }

    return NextResponse.json({ id: params.id });
  } catch (error) {
    console.error("Ошибка в PATCH /api/assignments/[id]:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }

    // Разговоры, начатые по заданию, остаются: у них своя ценность,
    // и расшифровка с разбором не должна пропасть вместе с заданием.
    // Отвязывать вручную не нужно — внешний ключ Session.assignmentId
    // объявлен с ON DELETE SET NULL (миграция 20260723093552_assignments)
    const { count } = await prisma.assignment.deleteMany({
      where: { id: params.id, createdById: head.id, status: "active" },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "Задание не найдено или уже выполнено" },
        { status: 404 }
      );
    }

    return NextResponse.json({ id: params.id });
  } catch (error) {
    console.error("Ошибка в DELETE /api/assignments/[id]:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
