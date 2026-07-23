// GET /api/assignments/count
// Число активных заданий для бейджа в боковом меню. Отдельный роут, потому
// что меню есть на каждой странице — тянуть ради счётчика весь список
// с пациентами и комментариями незачем.

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

    const count = await prisma.assignment.count({
      where: { userId: user.sub, status: "active" },
    });

    return NextResponse.json({ count });
  } catch (error) {
    console.error("Ошибка в /api/assignments/count:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
