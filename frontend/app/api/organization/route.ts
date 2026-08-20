// GET/PUT /api/organization
// Клиника руководителя: название, город, отрасль, услуги и диагнозы.
//
// Только для руководителя: отрасль и прайс — это данные организации, а не
// личные, и менеджеру их менять нечего. Проверка ролью, а не наличием
// организации: менеджер тоже в ней состоит.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { rebuildCases, сборкаЖива, идётСборка } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Услуг и диагнозов у клиники немного, но списки приходят от пользователя,
// и без потолка один запрос мог бы записать их тысячами
const MAX_SERVICES = 40;
const MAX_DIAGNOSES = 40;

interface ServiceBody {
  name?: string;
  price?: string;
  description?: string;
}

interface DiagnosisBody {
  name?: string;
  complaint?: string;
}

interface OrganizationBody {
  name?: string;
  city?: string;
  industry?: string;
  services?: ServiceBody[];
  diagnoses?: DiagnosisBody[];
}

async function organizationForForm(id: string) {
  const organization = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      city: true,
      industry: true,
      casesTotal: true,
      casesReady: true,
      casesUpdatedAt: true,
      casesRunning: true,
      services: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, price: true, description: true },
      },
      diagnoses: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, complaint: true },
      },
    },
  });
  if (!organization) return null;

  return { ...organization, casesRunning: сборкаЖива(organization) };
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
    return NextResponse.json(await organizationForForm(head.organizationId));
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

    // Сохранение во время сборки отклоняем целиком, а не «сохраним, но
    // пересоберём потом». Идущая сборка держит в руках прежний прайс и на
    // новый уже не посмотрит: часть пациентов вышла бы по старой отрасли,
    // часть по новой, и разобрать, кто по какой, было бы не по чему.
    // Ждать до конца сборки честнее, чем получить клинику вперемешку
    if (head.organizationId && (await идётСборка(head.organizationId))) {
      return NextResponse.json(
        { error: "Идёт сборка пациентов — сохранить получится, когда она закончится" },
        { status: 409 }
      );
    }

    let body: OrganizationBody;
    try {
      body = (await request.json()) as OrganizationBody;
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const name = body.name?.trim() ?? "";
    const city = body.city?.trim() ?? "";
    const industry = body.industry?.trim() ?? "";
    if (!name) {
      return NextResponse.json({ error: "Укажите название клиники" }, { status: 400 });
    }
    if (!city) {
      return NextResponse.json({ error: "Укажите город клиники" }, { status: 400 });
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

    const diagnoses = (body.diagnoses ?? [])
      .map((d) => ({
        name: d.name?.trim() ?? "",
        complaint: d.complaint?.trim() ?? "",
      }))
      .filter((d) => d.name || d.complaint);

    if (diagnoses.length > MAX_DIAGNOSES) {
      return NextResponse.json(
        { error: `Не больше ${MAX_DIAGNOSES} диагнозов` },
        { status: 400 }
      );
    }
    // Хотя бы один диагноз обязателен: без списка генератор вернулся бы
    // к сочинению болезней, ради отказа от которого всё и делается
    if (diagnoses.length === 0) {
      return NextResponse.json(
        { error: "Добавьте хотя бы один диагноз" },
        { status: 400 }
      );
    }
    // Жалоба обязательна наравне с диагнозом: одно название не говорит,
    // с чем человек приходит, и генератору не от чего оттолкнуться
    const неполный = diagnoses.findIndex((d) => !d.name || !d.complaint);
    if (неполный >= 0) {
      return NextResponse.json(
        { error: `В диагнозе №${неполный + 1} нужны и диагноз, и жалоба` },
        { status: 400 }
      );
    }

    const organizationId = head.organizationId;
    const saved = await prisma.$transaction(async (tx) => {
      const organization = organizationId
        ? await tx.organization.update({
            where: { id: organizationId },
            data: { name, city, industry, formSavedAt: new Date() },
            select: { id: true },
          })
        : await tx.organization.create({
            data: { name, city, industry, formSavedAt: new Date() },
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

      // Диагнозы — тем же приёмом, что и услуги
      await tx.diagnosis.deleteMany({ where: { organizationId: organization.id } });
      await tx.diagnosis.createMany({
        data: diagnoses.map((d, index) => ({
          organizationId: organization.id,
          name: d.name,
          complaint: d.complaint,
          position: index,
        })),
      });

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
    // Флаг поднимаем здесь, а не внутри rebuildCases: ответ уходит сразу,
    // а сборка стартует асинхронно — успей она поднять флаг после ответа,
    // страница получила бы «сборка не идёт» и показала окно обрыва
    // на живом процессе
    await prisma.organization.update({
      where: { id: saved },
      data: { casesRunning: true, casesUpdatedAt: new Date() },
    });

    void rebuildCases(saved, head.id).catch((error) =>
      console.error("Сборка случаев не удалась:", error)
    );

    return NextResponse.json(await organizationForForm(saved));
  } catch (error) {
    console.error("Ошибка в PUT /api/organization:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
