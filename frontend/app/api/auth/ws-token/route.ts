// GET /api/auth/ws-token
// Выдаёт одноразовый короткоживущий токен (TTL 30 сек) для авторизации
// WebSocket-соединения. Токен привязан к userId из основного JWT
// (httpOnly cookie) и сохраняется в Redis как { ws_token: userId }.

import { NextRequest, NextResponse } from "next/server";
import { createWsToken, getAuthUser, WS_TOKEN_TTL } from "@/lib/auth";

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
