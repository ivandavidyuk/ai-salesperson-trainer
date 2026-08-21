// POST /api/achievements/shown
// Плашки показаны — больше не всплывают. Зовётся при закрытии крестиком,
// по «Скрыть все» и при переходе на другую страницу.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const тело = await request.json().catch(() => null);
    const ids = (тело as { ids?: unknown } | null)?.ids;
    if (
      !Array.isArray(ids) ||
      ids.some((значение) => typeof значение !== "string")
    ) {
      return NextResponse.json(
        { error: "Ожидается массив ids" },
        { status: 400 }
      );
    }
    if (ids.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    // userId в условии: чужую плашку так не погасить, и не нужен отдельный
    // запрос на проверку владельца. shownAt: null — чтобы повторный вызов
    // не сдвигал дату у уже закрытых
    const результат = await prisma.userAchievement.updateMany({
      where: {
        userId: user.sub,
        achievementId: { in: ids as string[] },
        shownAt: null,
      },
      data: { shownAt: new Date() },
    });

    // Ноль — не ошибка: плашку могли закрыть в соседней вкладке
    return NextResponse.json({ updated: результат.count });
  } catch (error) {
    console.error("Ошибка в /api/achievements/shown:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
