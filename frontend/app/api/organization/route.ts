// GET/PUT /api/organization
// Клиника: название, город, отрасль, услуги и диагнозы.
//
// Читать может любой сотрудник клиники — менеджеру прайс нужен в разговоре,
// без него он называет цены из головы. Менять — только руководитель: отрасль
// и прайс — данные организации, а не личные. Проверка ролью, а не наличием
// организации: менеджер тоже в ней состоит.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserWithRole, requireHead } from "@/lib/access";
import {
  rebuildCases,
  сборкаЖива,
  идётСборка,
  целиПересборки,
} from "@/lib/cases";
import { ключ } from "@/lib/caseStaleness";
import { затронутыеСлучаи } from "@/lib/caseStaleness";
import { генерацияЗакрыта, этоДемо } from "@/lib/demoAccess";
import { медицинскаяОтрасль } from "@/lib/industry";
import { поставитьОтрасль } from "@/lib/industryCookie";
import { словаОтрасли } from "@/lib/industryWords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Услуг и диагнозов у клиники немного, но списки приходят от пользователя,
// и без потолка один запрос мог бы записать их тысячами
const MAX_SERVICES = 40;
const MAX_DIAGNOSES = 40;

/**
 * Имя, встретившееся дважды, — или null.
 *
 * Сверка «кого задела правка» сворачивает списки в Map по имени
 * (lib/caseStaleness.ts), и при одинаковых именах выживает последняя строка:
 * правка первой прошла бы незамеченной, а добавление второй пересобрало бы
 * всех носителей диагноза. Дешевле не пустить повтор в базу, чем разбирать
 * потом, какая из двух строк чья.
 */
function повторИмени(имена: string[]): string | null {
  const виденные = new Set<string>();
  for (const имя of имена) {
    const ключ = имя.trim().toLowerCase();
    if (виденные.has(ключ)) return имя;
    виденные.add(ключ);
  }
  return null;
}

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

/** Сколько случаев организации стоит на каждой позиции прайса, по названию */
async function клиентыНаПозициях(organizationId: string): Promise<Map<string, number>> {
  const группы = await prisma.patientCase.groupBy({
    by: ["serviceName"],
    where: { organizationId, serviceName: { not: null } },
    _count: { _all: true },
  });
  return new Map(
    группы
      .filter((г) => г.serviceName)
      .map((г) => [г.serviceName as string, г._count._all] as const)
  );
}

async function organizationForForm(id: string) {
  const organization = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      city: true,
      industry: true,
      // Демо-клинике форма показывается только на чтение: сохранение
      // запускает платную пересборку, и оно ей закрыто
      isDemo: true,
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

  // Сколько пациентов досталось каждому диагнозу. Диагноз без единого
  // пациента — обычно тот, который в прайсе нечем лечить: генератор такие
  // пары честно отбраковывает (clinical_picture.match_services), но молча.
  // Руководитель заводил диагноз и вправе увидеть, что он не работает
  const поДиагнозам = await prisma.patientCase.groupBy({
    by: ["diagnosisName"],
    where: { organizationId: id },
    _count: { _all: true },
  });
  // Имена сверяем той же нормализацией, что и правки прайса: diagnosisName
  // в случае пишет модель, и «миопия» там встречается наравне с «Миопия»
  const пациентов = new Map<string, number>();
  for (const г of поДиагнозам) {
    if (!г.diagnosisName) continue;
    const к = ключ(г.diagnosisName);
    пациентов.set(к, (пациентов.get(к) ?? 0) + г._count._all);
  }

  // Сколько клиентов стоит на каждой позиции прайса — у неклиник. Их случаи
  // написаны заранее и ищут цену по точному названию позиции
  // (lib/caseServiceQuery.ts): переименуй её РОП, и в упражнениях у этих
  // клиентов пропала бы цена. Форма по этому числу закрывает название
  // и удаление, а PUT не пускает такую правку
  const клиентовНа = медицинскаяОтрасль(organization.industry)
    ? null
    : await клиентыНаПозициях(id);

  return {
    ...organization,
    services: клиентовНа
      ? organization.services.map((у) => ({ ...у, clients: клиентовНа.get(у.name) ?? 0 }))
      : organization.services,
    diagnoses: organization.diagnoses.map((д) => ({
      ...д,
      patients: пациентов.get(ключ(д.name)) ?? 0,
    })),
    casesRunning: сборкаЖива(organization),
  };
}

export async function GET(request: NextRequest) {
  try {
    // Читать прайс и диагнозы может любой сотрудник клиники: менеджеру они
    // нужны в разговоре — на пресете чужой клиники он иначе называет цены
    // из головы и срывает сделки. Менять по-прежнему может только
    // руководитель, см. PUT
    const user = await getUserWithRole(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    if (!user.organizationId) {
      // Сотрудник без клиники — состояние возможное (пустая база,
      // пользователь заведён до организаций). Отдаём null, форма покажет пустую
      return NextResponse.json(null);
    }
    return NextResponse.json(await organizationForForm(user.organizationId));
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

    // Демо-клинике сохранение формы закрыто: за ним следом идёт пересборка
    // случаев, а это сотня вызовов модели за наш счёт — и одного нажатия
    // хватило бы, чтобы её запустить. Заодно это бережёт сам показ: случаи
    // пресета вычитаны людьми, а свежая генерация — нет, и подменять
    // первое вторым посреди демо незачем
    if (head.organizationId && (await этоДемо(head.organizationId))) {
      const демо = await prisma.organization.findUnique({
        where: { id: head.organizationId },
        select: { industry: true },
      });
      return NextResponse.json(
        { error: генерацияЗакрыта(демо?.industry ?? "") },
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

    // Отрасль неклиники меняем только мы: поле в форме у неё скрыто, а одна
    // правка текста перевела бы офис продаж на медицинский конвейер — платная
    // сборка диагнозов, результат диагностики на каждом разговоре. Клиентов
    // недвижимости заводим вручную (scripts/create-client.ts), с отраслью
    const прежняя = head.organizationId
      ? await prisma.organization.findUnique({
          where: { id: head.organizationId },
          select: { industry: true },
        })
      : null;
    const отрасльЗакреплена = прежняя !== null && !медицинскаяОтрасль(прежняя.industry);

    const name = body.name?.trim() ?? "";
    const city = body.city?.trim() ?? "";
    const industry = отрасльЗакреплена ? прежняя.industry : body.industry?.trim() ?? "";
    // Отказы — словами той отрасли, что прислали: руководитель видит их
    // под своей формой, а она уже говорит этими словами
    const слова = словаОтрасли(industry);
    if (!name) {
      return NextResponse.json(
        { error: `Укажите ${слова.названиеОрганизации.toLowerCase()}` },
        { status: 400 }
      );
    }
    if (!city) {
      return NextResponse.json(
        { error: `Укажите город ${слова.организации}` },
        { status: 400 }
      );
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
        { error: `Не больше ${MAX_SERVICES} ${слова.позиции[2]}` },
        { status: 400 }
      );
    }
    // Название и цена обязательны у каждой заполненной строки: без цены
    // пациенту нечем снимать страх «отдать большие деньги и пожалеть»
    const incomplete = services.findIndex((s) => !s.name || !s.price);
    if (incomplete >= 0) {
      return NextResponse.json(
        { error: `${слова.вПозиции} №${incomplete + 1} нужны название и цена` },
        { status: 400 }
      );
    }

    const повторУслуги = повторИмени(services.map((у) => у.name));
    if (повторУслуги) {
      return NextResponse.json(
        { error: `${слова.Позиция} «${повторУслуги}» есть в списке дважды — оставьте одну` },
        { status: 400 }
      );
    }

    // Позиции, на которых стоят клиенты неклиники, остаются в прайсе под
    // прежним названием: цену их случаи ищут по точному имени, а пересборки,
    // которая у клиник подхватывает правку, у этих отраслей нет
    if (отрасльЗакреплена && head.organizationId) {
      const имена = new Set(services.map((у) => у.name));
      const пропала = [...(await клиентыНаПозициях(head.organizationId)).keys()].find(
        (имя) => !имена.has(имя)
      );
      if (пропала) {
        return NextResponse.json(
          {
            error:
              `${слова.Позиция} «${пропала}» есть в заявках клиентов — удалить или ` +
              "переименовать её нельзя, можно поменять цену и описание",
          },
          { status: 400 }
        );
      }
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
    // к сочинению болезней, ради отказа от которого всё и делается.
    // У немедицинской отрасли генератора нет, и раздела диагнозов в форме
    // тоже: требовать их — значит не дать руководителю сохранить прайс
    if (diagnoses.length === 0 && медицинскаяОтрасль(industry)) {
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

    const повторДиагноза = повторИмени(diagnoses.map((д) => д.name));
    if (повторДиагноза) {
      return NextResponse.json(
        { error: `Диагноз «${повторДиагноза}» есть в списке дважды — оставьте один` },
        { status: 400 }
      );
    }

    const organizationId = head.organizationId;
    const saved = await prisma.$transaction(async (tx) => {
      // Снимок клиники ДО правки и происхождение её случаев.
      //
      // Читаем здесь и только здесь: ниже organization.update перепишет город
      // с отраслью, а deleteMany снесёт прежние услуги и диагнозы — после них
      // на вопрос «что именно изменилось» ответить будет нечем. Это и есть
      // причина, по которой сверка живёт в роуте, а не в сборке случаев.
      const было = organizationId
        ? await tx.organization.findUnique({
            where: { id: organizationId },
            select: {
              city: true,
              industry: true,
              services: {
                orderBy: { position: "asc" },
                select: { name: true, description: true },
              },
              diagnoses: {
                orderBy: { position: "asc" },
                select: { name: true, complaint: true },
              },
            },
          })
        : null;
      const прежниеСлучаи = organizationId
        ? await tx.patientCase.findMany({
            where: { organizationId },
            select: { patientId: true, diagnosisName: true, serviceName: true },
          })
        : [];

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

      // Кого правка задела. В той же транзакции, что и сама правка: иначе
      // упавшее между ними сохранение оставило бы новый прайс со старыми
      // отметками, и пересборка взялась бы не за тех
      // У немедицинской отрасли устаревших случаев не бывает: пересобирать
      // их нечем, цены называет менеджер вслух, а случай о них не знает
      const затронуты = было && медицинскаяОтрасль(industry)
        ? затронутыеСлучаи(было, { city, industry, services, diagnoses }, прежниеСлучаи)
        : [];
      if (затронуты.length > 0) {
        await tx.patientCase.updateMany({
          where: { organizationId: organization.id, patientId: { in: затронуты } },
          data: { staleSince: new Date() },
        });
      }

      return organization.id;
    });

    // Кого пересобираем на самом деле: помеченные правкой плюс те, у кого
    // случая нет вовсе. Спрашиваем до запуска, потому что от ответа зависит,
    // запускать ли вообще — правка цены не задевает никого, и платить
    // за неё нечем
    // Немедицинской отрасли сборка закрыта: её случаи — из пресета, и даже
    // пациенты без случая не собираются (набор пишется по одному). Значит
    // цели пусты по определению, и спрашивать их незачем
    const { цели } = медицинскаяОтрасль(industry)
      ? await целиПересборки(saved)
      : { цели: [] as string[] };

    if (цели.length === 0) {
      // Ничего не пересобираем — и счётчики обязаны сказать это честно.
      // Оставь их от прошлой сборки, страница показала бы «пересобрали 21»
      // над правкой, которая не тронула ни одного пациента
      await prisma.organization.update({
        where: { id: saved },
        data: {
          casesTotal: 0,
          casesReady: 0,
          casesRunning: false,
          casesUpdatedAt: new Date(),
        },
      });
      const ответ = NextResponse.json({
        ...(await organizationForForm(saved)),
        affected: 0,
      });
      // Отрасль могли поменять — cookie догоняет её сразу, а не со
      // следующей страницей
      поставитьОтрасль(ответ, industry);
      return ответ;
    }

    // Сборка случаев идёт после ответа: держать HTTP-запрос открытым на
    // десятки вызовов модели нельзя, его оборвут и Caddy, и браузер.
    // Интерфейс вместо этого держит лоадер и опрашивает casesReady/casesTotal,
    // которые пишет rebuildCases.
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
      data: {
        casesRunning: true,
        casesTotal: цели.length,
        casesReady: 0,
        casesUpdatedAt: new Date(),
      },
    });

    void rebuildCases(saved, head.id).catch((error) =>
      console.error("Сборка случаев не удалась:", error)
    );

    const ответ = NextResponse.json({
      ...(await organizationForForm(saved)),
      affected: цели.length,
    });
    поставитьОтрасль(ответ, industry);
    return ответ;
  } catch (error) {
    console.error("Ошибка в PUT /api/organization:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
