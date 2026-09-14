// POST /api/sessions/[id]/stop
// Завершает сессию: ставит статус completed и проставляет endedAt.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { ЕСТЬ_РЕПЛИКА_МЕНЕДЖЕРА } from "@/lib/statsWindow";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Проверяем авторизацию
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const sessionId = params.id;

    // Убеждаемся, что сессия существует и принадлежит пользователю
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== user.sub) {
      return NextResponse.json(
        { error: "Сессия не найдена" },
        { status: 404 }
      );
    }

    // Меняем статус на completed, проставляем время завершения и
    // длительность (её показывает главная и по ней считается средняя;
    // хранить отдельно дешевле, чем каждый раз вычитать даты в агрегатах)
    //
    // Уже проставленное не трогаем. Разговор мог оборваться раньше — тогда
    // backend закрыл сессию в момент разрыва сокета, и это её настоящий
    // конец. Экран у менеджера при обрыве не меняется (обработчика onclose
    // нет), он дожимает «Завершить» на мёртвом соединении, и без этой
    // защиты в счёт клиенту попало бы время до клика, а не до обрыва.
    const endedAt = session.endedAt ?? new Date();
    const durationSec =
      session.durationSec ??
      Math.max(
        0,
        Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
      );

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        endedAt,
        durationSec,
      },
    });

    // Разговор по заданию закрывает это задание — если разговор состоялся,
    // то есть в нём есть реплика менеджера. То же правило у бэкенда при
    // обрыве связи и у статистики. Без него сессия, брошенная сразу после
    // «Начать» или после открывающей реплики пациента, ставила руководителю
    // «выполнено», а в статистике и в списке разговоров её не было.
    //
    // Всё в условии одного updateMany: и чужое задание, и несостоявшийся
    // разговор отсекаются там же, где пишется статус.
    if (session.assignmentId) {
      await prisma.assignment.updateMany({
        where: {
          id: session.assignmentId,
          userId: user.sub,
          status: "active",
          sessions: { some: { id: sessionId, ...ЕСТЬ_РЕПЛИКА_МЕНЕДЖЕРА } },
        },
        data: { status: "done", completedAt: endedAt },
      });
    }

    return NextResponse.json({
      sessionId: updated.id,
      status: updated.status,
      endedAt: updated.endedAt,
    });
  } catch (error) {
    console.error("Ошибка в /api/sessions/[id]/stop:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
