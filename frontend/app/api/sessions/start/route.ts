// POST /api/sessions/start
// Создаёт новую сессию со статусом active для текущего пользователя
// и возвращает { sessionId, wsUrl, opensDialog, drill } для подключения
// к WebSocket-серверу. drill — название упражнения и его услуга для экрана
// звонка; у полного разговора null.
//
// Тело { patientId?, trainingType? } приходит из мастера настройки. Без тела
// роут работает как раньше — прямой заход на /session должен оставаться живым.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, signToken } from "@/lib/auth";
import { расходЧасовПользователя } from "@/lib/hours";
import { демоСтатус, засечьПервыйРазговор } from "@/lib/demoAccess";
import { ВЫБОР_ЗАКРЫТ, ДЕМО_ТИП, демоКлиенты } from "@/lib/demoScope";
import { backendUrl } from "@/lib/cases";
import type { CaseService } from "@/lib/caseService";
import { caseService } from "@/lib/caseServiceQuery";

// Организация без собранных случаев: пресет не налит и генерация не запускалась
const СЛУЧАЙ_НЕ_СОБРАН =
  "Для вашей организации этот клиент ещё не подготовлен";

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
    // Заговаривает ли пациент первым. Экран должен знать это ДО подключения:
    // сокет открывается, поднимает распознавание и синтез, и только потом
    // бэкенд успевает предупредить — полторы секунды, в которые экран просит
    // говорить менеджера, хотя начинает пациент
    let opensDialog = false;
    // Название упражнения под именем пациента — во всех упражнениях, кроме
    // полного разговора. Задачу менеджер читал в мастере, а после «Начать»
    // на экране не оставалось даже того, что он отрабатывает
    let drillTitle: string | null = null;
    let showsService = false;
    if (body.trainingType) {
      const type = await prisma.trainingType.findUnique({
        where: { id: body.trainingType },
        select: {
          id: true,
          title: true,
          isActive: true,
          scoresDeal: true,
          opensDialog: true,
          showsService: true,
        },
      });
      if (!type || !type.isActive) {
        return NextResponse.json(
          { error: "Этот тип тренировки пока недоступен" },
          { status: 400 }
        );
      }
      // В демо на разговоры открыт только полный: в списках остальные
      // погашены, но запрос с их id прийти может мимо интерфейса
      if (демо?.режим === "разговоры" && type.id !== ДЕМО_ТИП) {
        return NextResponse.json({ error: ВЫБОР_ЗАКРЫТ }, { status: 403 });
      }
      trainingTypeId = type.id;
      scoresDeal = type.scoresDeal;
      opensDialog = type.opensDialog;
      drillTitle = type.scoresDeal ? null : type.title;
      showsService = type.showsService;
    }

    // Роль пациента собирается только под организацию: глобального промпта
    // у пациента нет, и без случая организации разговор не из чего начать.
    // Проверяем это здесь, а не полагаемся на пустую роль в backend
    const владелец = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { organizationId: true },
    });
    const organizationId = владелец?.organizationId ?? null;
    if (!organizationId) {
      return NextResponse.json({ error: СЛУЧАЙ_НЕ_СОБРАН }, { status: 400 });
    }
    const соСлучаем = {
      cases: { some: { organizationId, prompt: { not: "" } } },
    };

    // Пациент, которого играет ИИ. Проверяем на сервере, что он активен
    // и что у организации есть его случай: в мастере закрытые показаны,
    // и запрос с их id прийти может.
    let patientId: string | null = null;
    if (body.patientId) {
      const chosen = await prisma.patient.findUnique({
        where: { id: body.patientId },
        select: { id: true, name: true, isActive: true },
      });
      if (!chosen || !chosen.isActive) {
        return NextResponse.json(
          { error: "Этот пациент пока недоступен" },
          { status: 400 }
        );
      }
      if (
        демо?.режим === "разговоры" &&
        !демоКлиенты(демо.industry).includes(chosen.name)
      ) {
        return NextResponse.json({ error: ВЫБОР_ЗАКРЫТ }, { status: 403 });
      }
      const случай = await prisma.patientCase.findFirst({
        where: { patientId: chosen.id, organizationId, prompt: { not: "" } },
        select: { patientId: true },
      });
      if (!случай) {
        return NextResponse.json({ error: СЛУЧАЙ_НЕ_СОБРАН }, { status: 400 });
      }
      patientId = chosen.id;
    } else {
      // Пациент не выбран — берём первого, у кого есть случай; без этой
      // привязки разговоры в истории остались бы без имени и темы. В демо
      // выбираем из открытой тройки, иначе прямой заход на /session привёл бы
      // к закрытому клиенту
      const fallback = await prisma.patient.findFirst({
        where: {
          isActive: true,
          ...соСлучаем,
          ...(демо?.режим === "разговоры"
            ? { name: { in: демоКлиенты(демо.industry) } }
            : {}),
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      patientId = fallback?.id ?? null;
    }
    // Ни одного пациента со случаем — организации не с кем разговаривать.
    // Отказать до создания сессии: иначе у демо начался бы суточный отсчёт
    if (!patientId) {
      return NextResponse.json({ error: СЛУЧАЙ_НЕ_СОБРАН }, { status: 400 });
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
        const res = await fetch(`${backendUrl()}/diagnostics/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId: session.id }),
        });
        // Отказ разбираем вслух: HTTP-ошибка — не reject, и без этой ветки
        // запрос, ушедший не на тот сервер, молчал бы. Ровно так 27.08
        // Caddy без маршрута /diagnostics/* возвращал HTML логина, а лог
        // был пуст — та же грабля, что с /cases/* 07.08
        if (!res.ok) {
          console.error(
            `Генерация результата диагностики: HTTP ${res.status} ` +
              `от ${backendUrl()} для сессии ${session.id}`
          );
        }
      })().catch((error) =>
        console.error("Генерация результата диагностики не запустилась:", error)
      );
    }

    // Услуга с ценой — сразу в ответе, а не отдельным запросом по кнопке:
    // в отработке возражений пациент может спросить про деньги через
    // полторы секунды после старта. Документ диагностики для неё не нужен,
    // услуга лежит в случае пациента
    let service: CaseService | null = null;
    if (showsService) {
      service = await caseService(patientId, organizationId);
    }

    // Формируем URL WebSocket-сервера (FastAPI).
    // Базовый адрес берём из env, по умолчанию — локальный.
    const wsBase = process.env.FASTAPI_WS_URL || "ws://localhost:8000";
    const wsUrl = `${wsBase}/ws/session/${session.id}`;

    return NextResponse.json({
      sessionId: session.id,
      wsUrl,
      opensDialog,
      drill: drillTitle ? { title: drillTitle, showsService, service } : null,
    });
  } catch (error) {
    console.error("Ошибка в /api/sessions/start:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
