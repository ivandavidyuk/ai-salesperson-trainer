// GET /api/team/[id]/sessions
// Все разговоры одного менеджера — для модалки «Все» на странице статистики.
// Только для руководителя.

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { round1 } from "@/lib/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

    // Смотреть можно только менеджеров: по id другого руководителя
    // страница ничего показывать не должна
    const manager = await prisma.user.findFirst({
      where: { id: params.id, role: UserRole.manager },
      select: { id: true, firstName: true, lastName: true, avatarUpdatedAt: true },
    });
    if (!manager) {
      return NextResponse.json({ error: "Менеджер не найден" }, { status: 404 });
    }

    const rows = await prisma.session.findMany({
      where: { userId: manager.id, status: "completed" },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        topic: true,
        startedAt: true,
        durationSec: true,
        review: { select: { overallScore: true } },
      },
    });

    return NextResponse.json({
      manager: {
        id: manager.id,
        name: `${manager.firstName} ${manager.lastName}`.trim(),
        avatarUpdatedAt: manager.avatarUpdatedAt?.toISOString() ?? null,
      },
      sessions: rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        startedAt: row.startedAt.toISOString(),
        durationSec: row.durationSec,
        score: round1(row.review?.overallScore ?? null),
      })),
    });
  } catch (error) {
    console.error("Ошибка в /api/team/[id]/sessions:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
