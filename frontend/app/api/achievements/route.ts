// GET /api/achievements
// Все достижения с отметкой, получено ли текущим пользователем, плюс сводка
// для прогресс-бара. Список общий для всех, различается только отметка.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

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
    const rows = await prisma.achievement.findMany({
      orderBy: { position: "asc" },
      include: {
        users: {
          where: { userId: user.sub },
          select: { unlockedAt: true },
        },
      },
    });

    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
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
