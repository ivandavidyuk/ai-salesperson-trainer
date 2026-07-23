// GET /api/team/stats
// Статистика по менеджерам отдела. Только для руководителя: чужие оценки
// и разговоры не должны быть видны рядовому менеджеру.

import { NextRequest, NextResponse } from "next/server";
import { requireHead } from "@/lib/access";
import { getTeamStats } from "@/lib/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }

    return NextResponse.json(await getTeamStats());
  } catch (error) {
    console.error("Ошибка в /api/team/stats:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
