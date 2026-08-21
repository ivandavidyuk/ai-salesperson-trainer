// POST /api/achievements/seen
// Человек зашёл на «Достижения» — счётчик в меню гаснет. Именно заходом
// на страницу, а не по таймеру и не закрытием плашки: полка и есть то
// место, где новость дочитывают до конца.

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

    // Владелец и есть ключ — отдельная проверка не нужна
    await prisma.user.update({
      where: { id: user.sub },
      data: { achievementsSeenAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ошибка в /api/achievements/seen:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
