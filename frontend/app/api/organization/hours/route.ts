// GET /api/organization/hours
// Остаток часов разговоров по тарифу клиники.
//
// Отдаётся и руководителю (карточка в кабинете), и менеджеру (окно «часы
// закончились» вместо мастера настройки). Роль не проверяем: остаток —
// это про отдел, в котором человек и так состоит, а знание своего лимита
// ничего чужого не открывает.

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { расходЧасовПользователя } from "@/lib/hours";
import { демоСтатус } from "@/lib/demoAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const счёт = await расходЧасовПользователя(user.sub);
    // null — пользователь вне клиники. Это не «часы кончились», и путать
    // одно с другим нельзя: интерфейс на null просто не показывает лимита
    if (!счёт) return NextResponse.json(null);

    // Демо-доступ едет тем же ответом: интерфейсу нужно и то и другое разом —
    // у демо исчерпанные часы показываются как конец демо, а не как лимит,
    // и карточка остатка в профиле у демо не рендерится вовсе
    const демо = await демоСтатус(user.sub);

    return NextResponse.json({
      limitSec: счёт.limitSec,
      usedSec: счёт.usedSec,
      leftSec: счёт.leftSec,
      resetsAt: счёт.resetsAt.toISOString(),
      exhausted: счёт.exhausted,
      demo: демо
        ? {
            expiresAt: демо.expiresAt?.toISOString() ?? null,
            expired: демо.разговорыЗакрыты,
          }
        : null,
    });
  } catch (error) {
    console.error("Ошибка в GET /api/organization/hours:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
