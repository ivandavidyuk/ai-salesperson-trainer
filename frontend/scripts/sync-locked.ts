// Подтяжка закрытых карточек к их пресету — при каждом старте контейнера,
// сразу после seed:presets.
//
// Зачем. Клиент получает случаи пациентов и прайс КОПИЕЙ пресета
// (scripts/demo-clinic.ts, скопироватьПресет), и дальше копия живёт сама:
// при старте обновляются только личности и механизм (rebuild-prompts),
// а история пациента, документ диагностики и прайс остаются прежними.
// У обычной клиники так и надо — руководитель правит прайс и пересобирает
// пациентов под себя, и перезапись из пресета стёрла бы его работу.
//
// У закрытой карточки (Organization.formLocked, lib/formLock.ts) правок
// клиники нет: её прайс и пациентов ведём мы. Копия там только вредит —
// правки пресета (по замечаниям врачей клиники) до неё не доходили бы,
// а перенос руками — это правка боевой базы на каждом шаге. Первой такой
// клиникой стала Jamaica (14.10).
//
// Что подтягивается: ключ отрасли и вариант правил, прайс и диагнозы,
// случаи всех пациентов пресета вместе с готовым промптом (его только что
// собрал seed:presets теми же правилами). Название, город, часы и люди
// клиники не трогаются. Пишется только то, что отличается: при совпадении —
// «обновлено 0», и запуск можно повторять сколько угодно.
//
//   npm run sync:locked

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/** JSON с ключами по алфавиту: одинаковое содержимое — одинаковая строка */
function стабильно(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const ПОЛЯ_СЛУЧАЯ = [
  "prompt",
  "caseData",
  "description",
  "anamnesis",
  "objections",
  "diagnosticsPreset",
  "diagnosisName",
  "serviceName",
  "reviewNote",
  "staleSince",
] as const;

async function подтянуть(организация: {
  id: string;
  name: string;
  industry: string;
  industryKey: string;
  rulesVariant: string | null;
}): Promise<string> {
  const пресет = await prisma.organization.findFirst({
    where: { isPreset: true, industry: организация.industry },
    select: {
      id: true,
      name: true,
      industryKey: true,
      rulesVariant: true,
      services: {
        orderBy: { position: "asc" },
        select: { name: true, price: true, description: true },
      },
      diagnoses: {
        orderBy: { position: "asc" },
        select: { name: true, complaint: true },
      },
    },
  });
  if (!пресет) {
    return `${организация.name}: пресета «${организация.industry}» нет — пропущена`;
  }

  const свои = await prisma.organization.findUnique({
    where: { id: организация.id },
    select: {
      services: {
        orderBy: { position: "asc" },
        select: { name: true, price: true, description: true },
      },
      diagnoses: {
        orderBy: { position: "asc" },
        select: { name: true, complaint: true },
      },
    },
  });
  const прайсОтличается = стабильно(свои?.services) !== стабильно(пресет.services);
  const диагнозыОтличаются = стабильно(свои?.diagnoses) !== стабильно(пресет.diagnoses);
  const правилаОтличаются =
    организация.industryKey !== пресет.industryKey ||
    организация.rulesVariant !== пресет.rulesVariant;

  const случаиПресета = await prisma.patientCase.findMany({
    where: { organizationId: пресет.id },
  });
  const своиСлучаи = new Map(
    (
      await prisma.patientCase.findMany({ where: { organizationId: организация.id } })
    ).map((с) => [с.patientId, с]),
  );

  const записи: Prisma.PrismaPromise<unknown>[] = [];
  let случаевОбновлено = 0;
  for (const образец of случаиПресета) {
    const свой = своиСлучаи.get(образец.patientId);
    const данные = Object.fromEntries(ПОЛЯ_СЛУЧАЯ.map((п) => [п, образец[п]]));
    if (свой && ПОЛЯ_СЛУЧАЯ.every((п) => стабильно(свой[п]) === стабильно(образец[п]))) {
      continue;
    }
    случаевОбновлено += 1;
    // Тип чтения Json допускает null, тип записи — нет: разводим явно
    const caseData =
      образец.caseData === null ? Prisma.JsonNull : (образец.caseData as Prisma.InputJsonValue);
    записи.push(
      prisma.patientCase.upsert({
        where: {
          patientId_organizationId: {
            patientId: образец.patientId,
            organizationId: организация.id,
          },
        },
        create: { ...данные, caseData, patientId: образец.patientId, organizationId: организация.id } as Prisma.PatientCaseUncheckedCreateInput,
        update: { ...данные, caseData } as Prisma.PatientCaseUncheckedUpdateInput,
      }),
    );
  }

  if (правилаОтличаются) {
    записи.push(
      prisma.organization.update({
        where: { id: организация.id },
        data: { industryKey: пресет.industryKey, rulesVariant: пресет.rulesVariant },
      }),
    );
  }
  if (прайсОтличается) {
    записи.push(
      prisma.service.deleteMany({ where: { organizationId: организация.id } }),
      prisma.service.createMany({
        data: пресет.services.map((у, i) => ({ ...у, organizationId: организация.id, position: i })),
      }),
    );
  }
  if (диагнозыОтличаются) {
    записи.push(
      prisma.diagnosis.deleteMany({ where: { organizationId: организация.id } }),
      prisma.diagnosis.createMany({
        data: пресет.diagnoses.map((д, i) => ({ ...д, organizationId: организация.id, position: i })),
      }),
    );
  }

  // Одной транзакцией: оборванная на середине подтяжка оставила бы клинику
  // с новым прайсом и старыми пациентами, которые стоят на удалённых услугах
  if (записи.length) await prisma.$transaction(записи);

  // Пациенты клиники, которых в пресете нет, не трогаем, но называем:
  // их случай больше никто не ведёт
  const лишние = [...своиСлучаи.keys()].filter(
    (id) => !случаиПресета.some((с) => с.patientId === id),
  ).length;

  return (
    `${организация.name} ← «${пресет.name}»: случаев обновлено ${случаевОбновлено} ` +
    `из ${случаиПресета.length}` +
    (прайсОтличается ? `, прайс заменён (${пресет.services.length})` : "") +
    (диагнозыОтличаются ? `, диагнозы заменены (${пресет.diagnoses.length})` : "") +
    (правилаОтличаются ? ", правила отрасли подтянуты" : "") +
    (лишние ? `, вне пресета пациентов: ${лишние}` : "")
  );
}

async function main(): Promise<void> {
  const закрытые = await prisma.organization.findMany({
    where: { formLocked: true, isPreset: false },
    select: { id: true, name: true, industry: true, industryKey: true, rulesVariant: true },
    orderBy: { name: "asc" },
  });
  if (!закрытые.length) {
    console.log("Закрытые карточки: ни одной");
    return;
  }
  for (const организация of закрытые) {
    console.log(`Закрытая карточка ${await подтянуть(организация)}`);
  }
}

main()
  .catch((ошибка) => {
    // Не роняем старт: подтяжка не нужна, чтобы приложение работало.
    // Клиника останется на прежних случаях — это хуже, чем свежие, но
    // несравнимо лучше лежащего сервиса
    console.error("Подтяжка закрытых карточек не удалась:", ошибка);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
