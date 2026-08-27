// POST /api/sessions/start
// Создаёт новую сессию со статусом active для текущего пользователя
// и возвращает { sessionId, wsUrl } для подключения к WebSocket-серверу.
//
// Тело { patientId?, trainingType? } приходит из мастера настройки. Без тела
// роут работает как раньше — прямой заход на /session должен оставаться живым.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, signToken } from "@/lib/auth";
import { расходЧасовПользователя } from "@/lib/hours";
import { демоСтатус, засечьПервыйРазговор } from "@/lib/demoAccess";
import { backendUrl } from "@/lib/cases";

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

    // Часы отдела кончились — новый разговор не начинаем. Проверка здесь,
    // а не только в интерфейсе: интерфейс не защита, и запрос сюда можно
    // отправить в обход кнопки. Идущий разговор это не трогает — он уже
    // начат, и обрывать его посреди было бы хуже, чем доиграть.
    const счёт = await расходЧасовПользователя(user.sub);
    if (счёт?.exhausted) {
      return NextResponse.json(
        {
          error: "Часы разговоров закончились",
          resetsAt: счёт.resetsAt.toISOString(),
        },
        { status: 402 }
      );
    }

    // Демо-доступ: сутки после первого разговора вышли — новых нет.
    // Текст без деталей: чем кончилось демо (временем или потолком часов),
    // клиенту знать не нужно
    const демо = await демоСтатус(user.sub);
    if (демо?.разговорыЗакрыты) {
      return NextResponse.json(
        { error: "Демо-доступ завершён" },
        { status: 402 }
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
    // Сделочный ли разговор. Без типа — полный разговор (сессии до мастера
    // настройки), как и backend считает через COALESCE(scoresDeal, true)
    let scoresDeal = true;
    if (body.trainingType) {
      const type = await prisma.trainingType.findUnique({
        where: { id: body.trainingType },
        select: { id: true, isActive: true, scoresDeal: true },
      });
      if (!type || !type.isActive) {
        return NextResponse.json(
          { error: "Этот тип тренировки пока недоступен" },
          { status: 400 }
        );
      }
      trainingTypeId = type.id;
      scoresDeal = type.scoresDeal;
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

    // Первый разговор демо-пары запускает суточный отсчёт. После создания
    // сессии, а не до: упавший create не должен тратить клинике сутки
    if (демо) {
      await засечьПервыйРазговор(демо.organizationId);
    }

    // Результат диагностики готовится заранее, пока менеджер проверяет
    // микрофон и читает анамнез, — к сценке в разговоре документ уже ждёт
    // кнопки. Fire-and-forget по образцу rebuildCases: упавшая генерация
    // не должна мешать старту разговора, кнопка добёрет синхронно.
    // Только для сделочного разговора: в этапных упражнениях сценки нет
    if (scoresDeal) {
      void (async () => {
        const token = await signToken({
          userId: user.sub,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        });
        await fetch(`${backendUrl()}/diagnostics/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId: session.id }),
        });
      })().catch((error) =>
        console.error("Генерация результата диагностики не запустилась:", error)
      );
    }

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
