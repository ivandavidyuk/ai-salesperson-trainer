// POST /api/sessions/start
// Создаёт новую сессию со статусом active для текущего пользователя
// и возвращает { sessionId, wsUrl } для подключения к WebSocket-серверу.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Проверяем авторизацию
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Создаём запись сессии со статусом active
    const session = await prisma.session.create({
      data: {
        userId: user.sub,
        status: "active",
      },
    });

    // Формируем URL WebSocket-сервера (FastAPI).
    // Базовый адрес берём из env, по умолчанию — локальный.
    const wsBase = process.env.FASTAPI_WS_URL || "ws://localhost:8000";
    const wsUrl = `${wsBase}/ws/session/${session.id}`;

    return NextResponse.json({
      sessionId: session.id,
      wsUrl,
    });
  } catch (error) {
    console.error("Ошибка в /api/sessions/start:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
