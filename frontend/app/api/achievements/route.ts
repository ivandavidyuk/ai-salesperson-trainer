// GET /api/achievements
// Все достижения с отметкой, получено ли текущим пользователем, плюс сводка
// для прогресс-бара. Список общий для всех, различается только отметка.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { словомОтрасли } from "@/lib/industryWords";
import { industryKey } from "@/scripts/industry-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Одним запросом: все достижения плюс связь текущего пользователя.
    // where внутри include оставляет максимум одну строку на достижение.
    // Описания написаны для клиник («диалог с пациентом») — у другой
    // отрасли они читаются её словами
    const [rows, владелец] = await Promise.all([
      prisma.achievement.findMany({
        orderBy: { position: "asc" },
        include: {
          users: {
            where: { userId: user.sub },
            select: { unlockedAt: true },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: user.sub },
        select: { organization: { select: { industry: true } } },
      }),
    ]);
    const отрасль = industryKey(владелец?.organization?.industry ?? "");

    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: словомОтрасли(row.description, отрасль),
      icon: row.icon,
      tone: row.tone,
      unlockedAt: row.users[0]?.unlockedAt.toISOString() ?? null,
    }));

    return NextResponse.json({
      total: items.length,
      unlocked: items.filter((item) => item.unlockedAt !== null).length,
      items,
    });
  } catch (error) {
    console.error("Ошибка в /api/achievements:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
