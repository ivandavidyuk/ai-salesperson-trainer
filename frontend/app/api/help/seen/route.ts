// POST /api/help/seen
// Человек открыл шпаргалку /help или закрыл объявление о ней крестиком.
// После этого метка «Новое» на кнопке в шапке и карточка новичка на главной
// больше не показываются. Отметка ставится один раз: повторный вызов её
// не сдвигает, чтобы дата говорила, когда шпаргалку увидели впервые.

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    await prisma.user.updateMany({
      where: { id: authUser.sub, helpSeenAt: null },
      data: { helpSeenAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Ошибка в /api/help/seen:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
