// GET /api/team/stats
// Статистика по менеджерам отдела. Только для руководителя: чужие оценки
// и разговоры не должны быть видны рядовому менеджеру.

import { NextRequest, NextResponse } from "next/server";
import { requireHead } from "@/lib/access";
import { getTeamStats, type StatsPeriod } from "@/lib/team";

/** Период приходит с витрины. Незнакомое значение — неделя, как по умолчанию */
const ПЕРИОДЫ: StatsPeriod[] = ["week", "month", "all"];

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

    const запрошен = request.nextUrl.searchParams.get("period");
    const period = ПЕРИОДЫ.find((p) => p === запрошен) ?? "week";

    // Считаем по клинике руководителя: чужой отдел ему не показываем
    return NextResponse.json(await getTeamStats(head.organizationId, period));
  } catch (error) {
    console.error("Ошибка в /api/team/stats:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
