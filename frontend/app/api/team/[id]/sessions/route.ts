// GET /api/team/[id]/sessions
// Все разговоры одного менеджера — для модалки «Все» на странице статистики.
// Только для руководителя.

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { round1 } from "@/lib/home";
import { завершённые } from "@/lib/statsWindow";

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

    // Смотреть можно только своих менеджеров: по id другого руководителя
    // или менеджера чужой клиники страница ничего показывать не должна.
    // Организация — в условии запроса, а не отдельной проверкой: без неё
    // руководитель одной клиники читал бы разговоры чужого менеджера,
    // зная его id
    const manager = await prisma.user.findFirst({
      where: {
        id: params.id,
        role: UserRole.manager,
        organizationId: head.organizationId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUpdatedAt: true,
        statsResetAt: true,
      },
    });
    if (!manager) {
      return NextResponse.json({ error: "Менеджер не найден" }, { status: 404 });
    }

    // Тот же фильтр, что у счётчиков на странице: иначе в списке видны
    // разговоры до обнуления, которых нет в цифрах на том же экране.
    // Пациент — чтобы строка называлась именем, а не словом «Разговор»:
    // тему приложение не заполняет
    const rows = await prisma.session.findMany({
      where: завершённые(manager.id, manager.statsResetAt),
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        topic: true,
        startedAt: true,
        durationSec: true,
        isFavorite: true,
        patient: { select: { name: true } },
        review: { select: { overallScore: true } },
      },
    });

    return NextResponse.json({
      manager: {
        id: manager.id,
        name: `${manager.firstName} ${manager.lastName}`.trim(),
        avatarUpdatedAt: manager.avatarUpdatedAt?.toISOString() ?? null,
      },
      // Форма — как у HomeConversation: список рисуется тем же компонентом,
      // что и у менеджера на главной
      sessions: rows.map((row) => ({
        id: row.id,
        patientName: row.patient?.name ?? null,
        topic: row.topic,
        startedAt: row.startedAt.toISOString(),
        durationSec: row.durationSec,
        score: round1(row.review?.overallScore ?? null),
        isFavorite: row.isFavorite,
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
