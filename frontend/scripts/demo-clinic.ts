// Копия отраслевого пресета в организацию и «Демо-клиника» для локальных сидов.
//
// Пресет — организация isPreset с вычитанными случаями, услугами и диагнозами;
// из неё только копируют: create-demo — в демо-организацию клиента, а сиды
// seed:demo и seed:team — в «Демо-клинику». Копия нужна, потому что с 16.09
// разговор без случая организации не начинается: глобального промпта
// у пациента больше нет, и пользователь без организации не заговорит.

import { Prisma, PrismaClient } from "@prisma/client";

export const ДЕМО_КЛИНИКА = "Демо-клиника";
const ОТРАСЛЬ_ДЕМО_КЛИНИКИ = "офтальмология";

export interface КопияПресета {
  имя: string;
  случаев: number;
  услуг: number;
  диагнозов: number;
}

/**
 * Копирует прайс, диагнозы и случаи пресета отрасли в организацию.
 * Пресета нет — null, и что с этим делать, решает вызывающий.
 *
 * Прайс и диагнозы копируются вместе со случаями. Разговору они не нужны —
 * цены звучат из уст менеджера, — но руководитель первым делом открывает
 * «Клиника и услуги», и пустая форма там читается как недоделанный продукт,
 * хотя случаи на месте.
 */
export async function скопироватьПресет(
  prisma: PrismaClient,
  organizationId: string,
  industry: string
): Promise<КопияПресета | null> {
  const пресет = await prisma.organization.findFirst({
    where: { isPreset: true, industry },
    select: { id: true, name: true },
  });
  if (!пресет) return null;

  const услуги = await prisma.service.findMany({
    where: { organizationId: пресет.id },
    orderBy: { position: "asc" },
  });
  const диагнозы = await prisma.diagnosis.findMany({
    where: { organizationId: пресет.id },
    orderBy: { position: "asc" },
  });
  if (услуги.length > 0) {
    await prisma.service.createMany({
      data: услуги.map((у, i) => ({
        organizationId,
        name: у.name,
        price: у.price,
        description: у.description,
        position: i,
      })),
    });
  }
  if (диагнозы.length > 0) {
    await prisma.diagnosis.createMany({
      data: диагнозы.map((д, i) => ({
        organizationId,
        name: д.name,
        complaint: д.complaint,
        position: i,
      })),
    });
  }

  const случаи = await prisma.patientCase.findMany({
    where: { organizationId: пресет.id },
  });
  if (случаи.length > 0) {
    await prisma.patientCase.createMany({
      // Спред, а не список полей поимённо. Список приходилось дописывать
      // при каждой новой колонке, и забытая колонка молча не доезжала
      // до демо: случай у клиента выглядел целым, но был беднее пресетного.
      // Со спредом следующее поле поедет само.
      data: случаи.map(({ organizationId: _, ...c }) => ({
        ...c,
        organizationId,
        // Тип чтения Json допускает null, тип записи — нет: разводим явно
        caseData:
          c.caseData === null
            ? Prisma.JsonNull
            : (c.caseData as Prisma.InputJsonValue),
      })),
    });
  }

  return {
    имя: пресет.name,
    случаев: случаи.length,
    услуг: услуги.length,
    диагнозов: диагнозы.length,
  };
}

/**
 * Организация для локальных демо-аккаунтов (seed:demo, seed:team): находит
 * по имени или создаёт и наливает в неё пресет офтальмологии. Если она уже
 * есть, но без случаев (сид прошёл раньше пресетов), докладывает случаи.
 * На проде демо выдаётся через create-demo, а эти сиды не запускаются.
 */
export async function демоКлиника(prisma: PrismaClient): Promise<string> {
  const есть = await prisma.organization.findFirst({
    where: { name: ДЕМО_КЛИНИКА },
    select: { id: true, _count: { select: { cases: true } } },
  });
  const организация =
    есть ??
    (await prisma.organization.create({
      data: { name: ДЕМО_КЛИНИКА, industry: ОТРАСЛЬ_ДЕМО_КЛИНИКИ },
      select: { id: true, _count: { select: { cases: true } } },
    }));
  if (организация._count.cases > 0) return организация.id;

  const копия = await скопироватьПресет(prisma, организация.id, ОТРАСЛЬ_ДЕМО_КЛИНИКИ);
  if (копия) {
    console.log(
      `«${ДЕМО_КЛИНИКА}»: случаев ${копия.случаев}, услуг ${копия.услуг}, ` +
        `диагнозов ${копия.диагнозов}`
    );
  } else {
    console.warn(
      `«${ДЕМО_КЛИНИКА}» без случаев: пресета офтальмологии в базе нет. ` +
        "Прогоните npm run seed:presets и этот сид ещё раз — иначе разговоры не начнутся"
    );
  }
  return организация.id;
}
