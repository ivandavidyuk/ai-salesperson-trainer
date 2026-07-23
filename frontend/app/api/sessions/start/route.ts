// POST /api/sessions/start
// Создаёт новую сессию со статусом active для текущего пользователя
// и возвращает { sessionId, wsUrl } для подключения к WebSocket-серверу.
//
// Тело { patientId?, trainingType? } приходит из мастера настройки. Без тела
// роут работает как раньше — прямой заход на /session должен оставаться живым.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";

interface StartBody {
  patientId?: string;
  trainingType?: string;
  assignmentId?: string;
}

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

    // Тело необязательное: прямой заход на /session шлёт пустой запрос
    let body: StartBody = {};
    try {
      body = (await request.json()) as StartBody;
    } catch {
      // пустое или неразбираемое тело — идём по старому пути
    }

    // Тип тренировки сверяем с базой: принимать на веру идентификатор
    // от клиента нельзя, а неактивные типы в мастере видны
    let trainingTypeId: string | null = null;
    if (body.trainingType) {
      const type = await prisma.trainingType.findUnique({
        where: { id: body.trainingType },
        select: { id: true, isActive: true },
      });
      if (!type || !type.isActive) {
        return NextResponse.json(
          { error: "Этот тип тренировки пока недоступен" },
          { status: 400 }
        );
      }
      trainingTypeId = type.id;
    }

    // Пациент, которого играет ИИ. Проверяем на сервере, что он активен:
    // в мастере неактивные показаны, и запрос с их id прийти может.
    let patientId: string | null = null;
    if (body.patientId) {
      const chosen = await prisma.patient.findUnique({
        where: { id: body.patientId },
        select: { id: true, isActive: true },
      });
      if (!chosen || !chosen.isActive) {
        return NextResponse.json(
          { error: "Этот пациент пока недоступен" },
          { status: 400 }
        );
      }
      patientId = chosen.id;
    } else {
      // Пациент не выбран — берём первого активного; без этой привязки
      // разговоры в истории остались бы без имени и темы.
      const fallback = await prisma.patient.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      patientId = fallback?.id ?? null;
    }

    // Задание, по которому запущен разговор. Владельца проверяем прямо
    // в условии запроса: чужое задание не должно находиться.
    let assignmentId: string | null = null;
    if (body.assignmentId) {
      const assignment = await prisma.assignment.findFirst({
        where: { id: body.assignmentId, userId: user.sub, status: "active" },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json(
          { error: "Задание не найдено" },
          { status: 404 }
        );
      }
      assignmentId = assignment.id;
    }

    // Создаём запись сессии со статусом active
    const session = await prisma.session.create({
      data: {
        userId: user.sub,
        patientId,
        trainingTypeId,
        assignmentId,
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
