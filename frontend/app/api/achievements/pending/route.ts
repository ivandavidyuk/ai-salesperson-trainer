// GET /api/achievements/pending
// Что показать человеку прямо сейчас: плашки в углу и число на счётчике.
// Отдельно от /api/achievements — тот отдаёт все 27 бейджей с описаниями,
// а этот роут опрашивается по таймеру, пока человек сидит на странице.

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

    // Забираем всю полку разом, а не два отдельных COUNT: бейджей всего 27,
    // больше строк у человека не бывает по составному ключу. Два условия
    // считаются в памяти и не разъезжаются между собой.
    const [профиль, открытия] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.sub },
        select: { achievementsSeenAt: true },
      }),
      prisma.userAchievement.findMany({
        where: { userId: user.sub },
        orderBy: { unlockedAt: "asc" },
        select: {
          unlockedAt: true,
          shownAt: true,
          achievement: {
            select: {
              id: true,
              name: true,
              description: true,
              icon: true,
              tone: true,
            },
          },
        },
      }),
    ]);

    const виделДо = профиль?.achievementsSeenAt ?? null;

    // Счётчик и плашки считаются по разным отметкам намеренно: закрытая
    // плашка не гасит счётчик, иначе «Скрыть все» съедало бы новость
    const count = открытия.filter(
      (строка) => виделДо === null || строка.unlockedAt > виделДо
    ).length;

    const items = открытия
      .filter((строка) => строка.shownAt === null)
      .map((строка) => ({
        id: строка.achievement.id,
        name: строка.achievement.name,
        description: строка.achievement.description,
        icon: строка.achievement.icon,
        tone: строка.achievement.tone,
        unlockedAt: строка.unlockedAt.toISOString(),
      }));

    return NextResponse.json({ count, items });
  } catch (error) {
    console.error("Ошибка в /api/achievements/pending:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
