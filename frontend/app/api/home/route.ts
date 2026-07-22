// GET /api/home
// Возвращает всё, что нужно главной странице, одним запросом:
// совет и мотивацию дня, статистику, последние разговоры и прогресс.

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getHomeData } from "@/lib/home";

export const runtime = "nodejs";
// Роут читает cookie и всегда отдаёт свежие данные
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const data = await getHomeData(authUser.sub);
    if (!data) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 401 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Ошибка в /api/home:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
