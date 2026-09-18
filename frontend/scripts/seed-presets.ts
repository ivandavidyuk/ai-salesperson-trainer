// Отраслевые пресеты: организации-шаблоны со случаями всех пациентов.
// Запуск: npm run seed:presets
//
// Сами тексты лежат по файлу на пациента в scripts/presets/<отрасль>/ —
// здесь только заливка. Промпт собирается тем же `buildRolePrompt`, что
// и пересборка под клиники (rebuild:prompts), и ПЕРЕЗАПИСЫВАЕТСЯ при каждом
// запуске: источник правды —
// репозиторий.
//
// Пресет-организация людей не имеет и в интерфейсе не показывается: из неё
// только копируют. Копирует `create-demo` при выдаче демо-доступа клинике
// той же отрасли; она же — заготовка для боевого клиента, которому не нужно
// генерировать случаи с нуля.
//
// Скрипт идемпотентный: организацию ищет по паре (isPreset, industry),
// случаи кладёт upsert-ом по составному ключу.

import { PrismaClient, Prisma } from "@prisma/client";
import { buildRolePrompt, industryRules } from "./patient-prompt";
import { PROFILES, составОтрасли } from "./patients";
import { ПРЕСЕТЫ } from "./presets";
import { клиническая, type Preset } from "./presets/types";

const prisma = new PrismaClient();

/**
 * Личности по имени — из них берётся всё, чего в пресете нет: характер,
 * манера, страхи, деньги, механика согласующего.
 */
const ЛИЧНОСТИ = new Map(PROFILES.map((p) => [p.name, p.personality]));

/**
 * Отрасль как ключ поиска: нижний регистр без пробелов по краям.
 *
 * Та же формула, что в create-demo.ts, и это не совпадение — там ею
 * нормализуется `--industry`, здесь то, с чем он будет сверяться. Разойдутся
 * на один регистр — пресет молча перестанет находиться, и create-demo
 * откажет: без случаев разговоры не начнутся.
 */
const ключОтрасли = (industry: string) => industry.toLowerCase().trim();

async function залитьОтрасль(пресет: Preset): Promise<void> {
  const { clinic, cases } = пресет;
  const industry = ключОтрасли(clinic.industry);

  console.log(`\n=== ${clinic.orgName} ===\n`);

  // Пациент без случая — жёсткий отказ, а не предупреждение: у клиники этой
  // отрасли такой пациент будет виден в списке, а разговор с ним не начнётся —
  // случая нет, и старт честно откажет. Набор либо целый, либо никакой.
  //
  // Исключение — набор в работе (`inProgress`): он пишется по одному случаю
  // и заливается как есть, чтобы первые случаи можно было слушать на проде
  // в тестовой организации. 18.09 эта проверка молча не пустила недвижимость:
  // признак ввели в проверку формы, а сюда не донесли
  const покрыты = new Set(cases.map((с) => с.patientName));
  // Полнота считается по составу отрасли, а не по всей библиотеке
  const состав = составОтрасли(clinic.industry);
  const непокрытые = состав.filter((p) => !покрыты.has(p.name));
  if (непокрытые.length > 0 && !clinic.inProgress) {
    throw new Error(
      `${clinic.orgName}: нет случаев для ${непокрытые.map((p) => p.name).join(", ")}. ` +
        `Частичный пресет заливать нельзя — непокрытые пациенты видны в списке, ` +
        `а разговор с ними не начнётся.`,
    );
  }
  if (непокрытые.length > 0) {
    console.log(
      `набор в работе: случаев ${cases.length} из ${состав.length}, ` +
        `без случая — ${непокрытые.map((p) => p.name).join(", ")}`,
    );
  }

  const существует = await prisma.organization.findFirst({
    where: { isPreset: true, industry },
    select: { id: true },
  });

  const данные = {
    name: clinic.orgName,
    industry,
    isPreset: true,
    // Людей у пресета нет, разговоров тоже — лимит часов здесь ничего
    // не значит и стоит просто ненулевым
    hoursLimit: 1,
  };

  const организация = существует
    ? await prisma.organization.update({ where: { id: существует.id }, data: данные })
    : await prisma.organization.create({ data: данные });
  console.log(`${существует ? "обновлена" : "создана  "} организация · industry «${industry}»`);

  // Прайс и диагнозы переписываем целиком: они нужны QA-прогону (менеджер-
  // симулятор получает прайс) и перегенерации, если клиент захочет свои
  // услуги. В демо-клинику они не копируются — цены звучат из уст менеджера
  await prisma.$transaction([
    prisma.service.deleteMany({ where: { organizationId: организация.id } }),
    prisma.diagnosis.deleteMany({ where: { organizationId: организация.id } }),
    prisma.service.createMany({
      data: clinic.services.map((у, i) => ({
        organizationId: организация.id,
        name: у.name,
        price: у.price,
        description: у.description,
        position: i,
      })),
    }),
    prisma.diagnosis.createMany({
      data: clinic.diagnoses.map((д, i) => ({
        organizationId: организация.id,
        name: д.name,
        complaint: д.complaint,
        position: i,
      })),
    }),
  ]);
  console.log(`услуг ${clinic.services.length}, диагнозов ${clinic.diagnoses.length}`);

  for (const пресетныйСлучай of cases) {
    const личность = ЛИЧНОСТИ.get(пресетныйСлучай.patientName);
    if (!личность) {
      throw new Error(
        `${clinic.orgName}: случай написан для «${пресетныйСлучай.patientName}», ` +
          `а такого пациента в репозитории нет`,
      );
    }
    const пациент = await prisma.patient.findFirst({
      where: { name: пресетныйСлучай.patientName },
      select: { id: true },
    });
    if (!пациент) {
      // Новый персонаж попадает в базу только через seed:patients, а он
      // гоняется руками. У набора в работе это штатная ситуация между мержем
      // и ручным сидом: случай пропускаем и говорим, что сделать, — иначе
      // старт контейнера заканчивался бы «ЗАЛИВКА ПРЕСЕТОВ НЕ УДАЛАСЬ»
      if (clinic.inProgress) {
        console.log(
          `  ${пресетныйСлучай.patientName.padEnd(22)} пациента нет в базе — случай пропущен: ` +
            `npm run seed:patients, затем npm run seed:presets`,
        );
        continue;
      }
      throw new Error(
        `${clinic.orgName}: пациента «${пресетныйСлучай.patientName}» нет в базе — ` +
          `сначала npm run seed:patients`,
      );
    }

    const prompt = buildRolePrompt(
      { personality: личность, case: пресетныйСлучай.case },
      industryRules(clinic.industry),
    );
    const строка = {
      prompt,
      // Слоты — источник правды: rebuild-prompts пересоберёт из них promt
      // на каждом деплое, подмешав сегодняшние личность и механизм
      caseData: пресетныйСлучай.case as unknown as Prisma.InputJsonValue,
      description: пресетныйСлучай.description,
      anamnesis: пресетныйСлучай.anamnesis,
      objections: пресетныйСлучай.objections,
      // Пресеты вычитаны людьми — пометке критика тут взяться неоткуда
      reviewNote: null,
      // Документ диагностики: есть у случая — менеджер увидит его,
      // нет — включится генератор
      diagnosticsPreset: пресетныйСлучай.diagnostics ?? null,
      // Происхождение случая — то же, что генератор пишет из своих трёх шагов:
      // диагноз клинической картины и услуга, подобранная под него.
      //
      // Без этих двух полей пресетный случай выглядел бы как случай неизвестного
      // происхождения, а такой считается затронутым любой правкой формы. Первая
      // же правка цены пересобрала бы всех двадцать одного — то есть стёрла
      // вычитанные врачом тексты ради строки, которой в них нет.
      // У офиса продаж на месте диагноза — повод. Проверка устаревания
      // (lib/caseStaleness.ts) сверяет его со списком диагнозов организации,
      // которого у офиса продаж нет, — для немедицинских отраслей она
      // переписывается вместе с закрытием генерации (каркас, п. 8)
      diagnosisName: клиническая(пресетныйСлучай.picture)
        ? пресетныйСлучай.picture.diagnosis
        : пресетныйСлучай.picture.reason,
      serviceName: пресетныйСлучай.service,
      // Залитый из репозитория случай отвечает прайсу, который лежит рядом
      // в том же пресете, — устаревшим он быть не может по построению
      staleSince: null,
    };

    await prisma.patientCase.upsert({
      where: {
        patientId_organizationId: {
          patientId: пациент.id,
          organizationId: организация.id,
        },
      },
      update: строка,
      create: {
        patientId: пациент.id,
        organizationId: организация.id,
        ...строка,
      },
    });
    console.log(
      `  ${пресетныйСлучай.patientName.padEnd(22)} ${строка.diagnosisName}`,
    );
  }

  console.log(`случаев залито: ${cases.length}`);
}

async function main() {
  console.log("=== Отраслевые пресеты ===");

  for (const пресет of ПРЕСЕТЫ) {
    await залитьОтрасль(пресет);
  }

  console.log(
    `\nОтраслей: ${ПРЕСЕТЫ.length}. Промпты пресетов перезаписаны из репозитория.`,
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("\nНепредвиденная ошибка:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
