// GET /api/auth/ws-token
// Выдаёт одноразовый короткоживущий токен (TTL 30 сек) для авторизации
// WebSocket-соединения. Токен привязан к userId из основного JWT
// (httpOnly cookie) и сохраняется в Redis как { ws_token: userId }.

import { NextRequest, NextResponse } from "next/server";
import { createWsToken, getAuthUser, WS_TOKEN_TTL } from "@/lib/auth";
import { расходЧасовПользователя } from "@/lib/hours";
import { демоСтатус } from "@/lib/demoAccess";

export const runtime = "nodejs";
// Роут читает cookie запроса — рендерится только динамически
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Проверяем основную авторизацию (JWT из cookie + whitelist в Redis)
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Второй замок на том же входе. Токен — единственное, чем открывается
    // голосовой сокет, и без проверки здесь исчерпанный лимит обходился бы
    // запросом за токеном напрямую, минуя создание сессии
    const счёт = await расходЧасовПользователя(user.sub);
    if (счёт?.exhausted) {
      return NextResponse.json(
        { error: "Часы разговоров закончились" },
        { status: 402 }
      );
    }

    // Тот же второй замок для демо: истёкшие сутки без проверки здесь
    // обходились бы запросом за токеном напрямую
    const демо = await демоСтатус(user.sub);
    if (демо?.разговорыЗакрыты) {
      return NextResponse.json(
        { error: "Демо-доступ завершён" },
        { status: 402 }
      );
    }

    // Создаём одноразовый ws-токен для этого пользователя
    const wsToken = await createWsToken(user.sub);

    return NextResponse.json({ wsToken, expiresIn: WS_TOKEN_TTL });
  } catch (error) {
    console.error("Ошибка в /api/auth/ws-token:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
