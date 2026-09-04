// GET /api/sessions/[id]/transcript
// Всё, что нужно странице расшифровки, одним запросом: шапка разговора,
// реплики в хронологическом порядке и разбор (если он уже есть).

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/access";
import type { CaseService } from "@/lib/caseService";

export const runtime = "nodejs";
// Роут читает cookie запроса — рендерится только динамически
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id: params.id },
      select: {
        userId: true,
        topic: true,
        startedAt: true,
        // Нужен странице, чтобы понять, ждать ли разбор: он приходит
        // фоновой задачей через несколько секунд после конца разговора
        endedAt: true,
        durationSec: true,
        diagnosticsResult: true,
        diagnosticsShownAt: true,
        // Кнопке «Ещё разговор»: повторить того же пациента и тот же тип
        patientId: true,
        trainingTypeId: true,
        patient: { select: { name: true } },
        // Организация того, кто вёл разговор, — по ней ищется случай
        // пациента и его услуга; у читателя-руководителя она та же
        user: { select: { organizationId: true } },
        review: {
          select: {
            overallScore: true,
            contactScore: true,
            iceBreakerScore: true,
            needsScore: true,
            objectionsScore: true,
            closingScore: true,
            outcome: true,
            drillPassed: true,
            strength: true,
            growthPoint: true,
            // judgeNotes не отдаём: это разбор по обязательным условиям,
            // то есть готовый ответ для следующей попытки
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, text: true, createdAt: true },
        },
      },
    });

    // Свой разговор видит менеджер, любой — руководитель: со страницы
    // статистики он открывает разборы подчинённых, ради этого она и нужна.
    // Чужой разговор не отличаем от несуществующего — по ответу нельзя
    // узнать, что сессия с таким id вообще есть.
    const canRead =
      session &&
      (session.userId === user.id || user.role === UserRole.head);
    if (!session || !canRead) {
      return NextResponse.json({ error: "Разговор не найден" }, { status: 404 });
    }

    // Инициалы в аватарах реплик — того, кто вёл разговор, а не того,
    // кто читает: у руководителя иначе стояли бы его собственные
    const manager = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { firstName: true, lastName: true },
    });

    // Услуга к документу: имя из случая, цена — из прайса той же организации
    // по этому имени. Нет имени или его больше нет в прайсе — «не подобрана».
    // Ищем только когда документ показан: без него блока нет
    const diagnosticsService = session.diagnosticsShownAt
      ? await caseService(session.patientId, session.user.organizationId)
      : null;

    return NextResponse.json({
      session: {
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        durationSec: session.durationSec,
        topic: session.topic,
        patientName: session.patient?.name ?? null,
        patientId: session.patientId,
        trainingTypeId: session.trainingTypeId,
        // Документ диагностики отдаём только показанный: середина
        // расшифровки на него ссылается, и без него читателю не сойдётся
        // контекст. Сгенерированный, но не показанный — не существовал
        diagnosticsResult: session.diagnosticsShownAt
          ? session.diagnosticsResult
          : null,
        diagnosticsShownAt: session.diagnosticsShownAt?.toISOString() ?? null,
        diagnosticsService,
      },
      manager: {
        firstName: manager?.firstName ?? "",
        lastName: manager?.lastName ?? "",
      },
      messages: session.messages.map((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
      })),
      review: session.review,
    });
  } catch (error) {
    console.error("Ошибка в /api/sessions/[id]/transcript:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * Услуга случая с ценой из прайса. null — «не подобрана»: у случая нет
 * услуги вовсе (диагноз без лечащей услуги) либо её уже удалили из прайса.
 * Для менеджера это одно состояние: продать то, чего нет в прайсе, нельзя,
 * а имя без цены читалось бы как подсказка.
 */
async function caseService(
  patientId: string | null,
  organizationId: string | null
): Promise<CaseService | null> {
  if (!patientId || !organizationId) return null;
  const patientCase = await prisma.patientCase.findUnique({
    where: { patientId_organizationId: { patientId, organizationId } },
    select: { serviceName: true },
  });
  if (!patientCase?.serviceName) return null;
  const service = await prisma.service.findFirst({
    where: { organizationId, name: patientCase.serviceName },
    select: { name: true, price: true },
  });
  return service ? { name: service.name, price: service.price } : null;
}
