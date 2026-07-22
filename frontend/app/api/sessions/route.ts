// GET /api/sessions
// Полный список завершённых разговоров пользователя —
// для модалки «Все разговоры» на главной.

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { listConversations } from "@/lib/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const conversations = await listConversations(user.sub);
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Ошибка в /api/sessions:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
