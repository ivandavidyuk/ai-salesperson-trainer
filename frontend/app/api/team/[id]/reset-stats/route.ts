// POST/DELETE /api/team/[id]/reset-stats
// Обнуление статистики одного менеджера и возврат обнулённого.
// Только для руководителя.
//
// Обнуление мягкое: разговоры, разборы и расшифровки остаются в базе,
// меняется только отметка, от которой считается статистика. Поэтому DELETE
// возвращает всё как было — руководитель, нажавший не на того человека,
// не теряет ничего.
//
// На расход часов это не влияет: часы потрачены и оплачены, а обнуление,
// которое сбрасывало бы ещё и счёт по тарифу, было бы способом не платить.

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ставит или снимает отметку обнуления.
 *
 * Владельца проверяем прямо в условии запроса: обнулить чужого менеджера
 * не должно получиться даже теоретически, а отдельная выборка «сначала
 * найдём, потом обновим» оставляет между собой щель.
 */
async function отметить(
  request: NextRequest,
  managerId: string,
  statsResetAt: Date | null
) {
  const head = await requireHead(request);
  if (!head) {
    return NextResponse.json(
      { error: "Доступно только руководителю" },
      { status: 403 }
    );
  }

  const { count } = await prisma.user.updateMany({
    where: {
      id: managerId,
      role: UserRole.manager,
      organizationId: head.organizationId,
    },
    data: { statsResetAt },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Менеджер не найден" }, { status: 404 });
  }
  return NextResponse.json({ statsResetAt });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    return await отметить(request, params.id, new Date());
  } catch (error) {
    console.error("Ошибка в POST /api/team/[id]/reset-stats:", error);
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
    return await отметить(request, params.id, null);
  } catch (error) {
    console.error("Ошибка в DELETE /api/team/[id]/reset-stats:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
