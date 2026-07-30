// POST /api/organization/rebuild
// «Собрать заново» после обрыва: продолжает с места, а не идёт по кругу.
//
// Отдельный роут, а не повторное сохранение формы: данные клиники
// не менялись, и переписывать их незачем. Разница видна в поведении —
// сохранение формы пересобирает всех, этот роут только недостающих.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { rebuildCases } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }
    if (!head.organizationId) {
      return NextResponse.json({ error: "Клиника не заполнена" }, { status: 400 });
    }

    // Флаг поднимаем до старта, как и при сохранении формы: иначе страница
    // успеет опросить статус между ответом и началом сборки и решит,
    // что сборка уже кончилась
    await prisma.organization.update({
      where: { id: head.organizationId },
      data: { casesRunning: true, casesUpdatedAt: new Date() },
    });

    // Как и при сохранении формы, сборка идёт после ответа: держать HTTP
    // открытым на сотню вызовов модели нельзя, интерфейс опрашивает прогресс
    void rebuildCases(head.organizationId, head.id, { resume: true }).catch((error) =>
      console.error("Досборка случаев не удалась:", error)
    );

    return NextResponse.json({ started: true });
  } catch (error) {
    console.error("Ошибка в POST /api/organization/rebuild:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
