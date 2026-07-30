// GET/PUT /api/organization
// Клиника руководителя: название, отрасль и услуги.
//
// Только для руководителя: отрасль и прайс — это данные организации, а не
// личные, и менеджеру их менять нечего. Проверка ролью, а не наличием
// организации: менеджер тоже в ней состоит.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { rebuildCases } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Услуг у клиники немного, но список приходит от пользователя, и без потолка
// один запрос мог бы записать их тысячами
const MAX_SERVICES = 40;

interface ServiceBody {
  name?: string;
  price?: string;
  description?: string;
}

interface OrganizationBody {
  name?: string;
  industry?: string;
  services?: ServiceBody[];
}

function organizationWithServices(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      industry: true,
      casesTotal: true,
      casesReady: true,
      casesUpdatedAt: true,
      services: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, price: true, description: true },
      },
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }
    if (!head.organizationId) {
      // Руководитель без клиники — состояние возможное (пустая база,
      // пользователь заведён до организаций). Отдаём null, форма покажет пустую
      return NextResponse.json(null);
    }
    return NextResponse.json(await organizationWithServices(head.organizationId));
  } catch (error) {
    console.error("Ошибка в GET /api/organization:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }

    let body: OrganizationBody;
    try {
      body = (await request.json()) as OrganizationBody;
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const name = body.name?.trim() ?? "";
    const industry = body.industry?.trim() ?? "";
    if (!name) {
      return NextResponse.json({ error: "Укажите название клиники" }, { status: 400 });
    }
    if (!industry) {
      return NextResponse.json({ error: "Укажите отрасль" }, { status: 400 });
    }

    // Пустые строки списка просто отбрасываем: пользователь мог добавить
    // строку и передумать, ругаться на это незачем
    const services = (body.services ?? [])
      .map((s) => ({
        name: s.name?.trim() ?? "",
        price: s.price?.trim() ?? "",
        description: s.description?.trim() || null,
      }))
      .filter((s) => s.name || s.price || s.description);

    if (services.length > MAX_SERVICES) {
      return NextResponse.json(
        { error: `Не больше ${MAX_SERVICES} услуг` },
        { status: 400 }
      );
    }
    // Название и цена обязательны у каждой заполненной строки: без цены
    // пациенту нечем снимать страх «отдать большие деньги и пожалеть»
    const incomplete = services.findIndex((s) => !s.name || !s.price);
    if (incomplete >= 0) {
      return NextResponse.json(
        { error: `В услуге №${incomplete + 1} нужны название и цена` },
        { status: 400 }
      );
    }

    const organizationId = head.organizationId;
    const saved = await prisma.$transaction(async (tx) => {
      const organization = organizationId
        ? await tx.organization.update({
            where: { id: organizationId },
            data: { name, industry },
            select: { id: true },
          })
        : await tx.organization.create({
            data: { name, industry },
            select: { id: true },
          });

      // Руководитель без клиники создаёт её собой же — иначе форма сохранится
      // в пустоту, а он останется ни к чему не привязан
      if (!organizationId) {
        await tx.user.update({
          where: { id: head.id },
          data: { organizationId: organization.id },
        });
      }

      // Список переписываем целиком: он короткий, а сопоставлять строки
      // по идентификаторам ради двух десятков записей — лишняя сложность,
      // в которой легко потерять порядок
      await tx.service.deleteMany({ where: { organizationId: organization.id } });
      if (services.length > 0) {
        await tx.service.createMany({
          data: services.map((s, index) => ({
            organizationId: organization.id,
            name: s.name,
            price: s.price,
            description: s.description,
            position: index,
          })),
        });
      }

      return organization.id;
    });

    // Сборка случаев идёт после ответа: сто пациентов — сто вызовов модели,
    // и держать HTTP-запрос открытым столько времени нельзя, его оборвут
    // и Caddy, и браузер. Интерфейс вместо этого держит лоадер и опрашивает
    // casesReady/casesTotal, которые пишет rebuildCases.
    //
    // Отпускаем без await намеренно, но с обработчиком: необработанное
    // отклонение в Node роняет процесс, а сборка случаев не имеет права
    // ронять сервер.
    void rebuildCases(saved, head.id).catch((error) =>
      console.error("Сборка случаев не удалась:", error)
    );

    return NextResponse.json(await organizationWithServices(saved));
  } catch (error) {
    console.error("Ошибка в PUT /api/organization:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
