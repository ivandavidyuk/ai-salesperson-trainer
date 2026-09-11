// Выдача демо-доступа. Режима два.
//
//   npm run create-demo -- --clinic "Улыбка" --industry стоматология
//   npm run create-demo -- --clinic "Улыбка" --industry стоматология --talks 3
//
// Без --talks: пара аккаунтов РОП + менеджер на сутки — это доступ команде
// после созвона. С --talks: один аккаунт собственнику до созвона, доступ
// меряется разговорами, открыты три клиента и полный разговор.
//
// Что делает:
// 1. Создаёт организацию «Демо · Улыбка»: isDemo, потолок hoursLimit = 3.
//    Сутки начнут тикать с ПЕРВОГО разговора (lib/demoAccess.ts), не с выдачи;
//    у режима на разговоры суток нет вовсе.
// 2. Ищет отраслевой пресет — организацию isPreset с той же отраслью —
//    и копирует её случаи. Пресета нет: суточному демо честно говорит
//    об этом и выдаёт на глобальных промптах (они офтальмологические),
//    а демо собственнику отказывает — оно уходит в переписке без нас рядом.
// 3. Создаёт аккаунты со случайными паролями и печатает блок,
//    который целиком пересылается Диме.

import { Prisma, PrismaClient } from "@prisma/client";
import { ДЕМО_КЛИЕНТЫ } from "../lib/demoScope";
import { plural } from "../lib/format";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

/** Потолок расхода демо-организации, часов. Аварийный, клиенту не называется */
const ПОТОЛОК_ЧАСОВ = 3;

/**
 * Пароль, который можно продиктовать голосом: без нулей, «о», единиц и «л».
 * 10 знаков base58-алфавита — ~58 бит, для суточного доступа с запасом.
 */
function пароль(): string {
  const алфавит = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const байты = randomBytes(10);
  return Array.from(байты, (b) => алфавит[b % алфавит.length]).join("");
}

/** Слаг для email: транслитерация не нужна, достаточно латиницы и цифр */
function слаг(имя: string): string {
  const из = "абвгдежзийклмнопрстуфхцчшщъыьэюяё";
  const в = ["a","b","v","g","d","e","zh","z","i","y","k","l","m","n","o","p",
             "r","s","t","u","f","h","c","ch","sh","sch","","y","","e","yu","ya","e"];
  const лат = имя
    .toLowerCase()
    .split("")
    .map((ч) => {
      const i = из.indexOf(ч);
      return i >= 0 ? в[i] : ч;
    })
    .join("");
  const чистый = лат.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Пустой слаг (имя целиком из спецсимволов) — подставляем метку времени
  return чистый || `clinic-${Date.now()}`;
}

/** «1 разговор», «3 разговора», «5 разговоров» — блок уходит клиенту */
const разговорОв = (n: number) =>
  plural(n, "разговор", "разговора", "разговоров");

/** Сколько разговоров даёт демо. null — суточный режим */
function число(имя: string): number | null {
  const i = process.argv.indexOf(`--${имя}`);
  if (i < 0) return null;
  const знач = Number(process.argv[i + 1]);
  if (!Number.isInteger(знач) || знач < 1) {
    console.error(`--${имя} должен быть целым числом больше нуля`);
    process.exit(1);
  }
  return знач;
}

function аргумент(имя: string): string | null {
  const i = process.argv.indexOf(`--${имя}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const клиника = аргумент("clinic");
  const отрасль = аргумент("industry");
  const разговоров = число("talks");
  if (!клиника || !отрасль) {
    console.error(
      'Использование: npm run create-demo -- --clinic "Улыбка" ' +
        "--industry стоматология [--talks 3]"
    );
    process.exit(1);
  }

  console.log(
    разговоров
      ? `=== Демо-доступ на ${разговоров} ${разговорОв(разговоров)} — собственнику ===\n`
      : "=== Демо-доступ на сутки — команде ===\n"
  );

  // Слаг должен быть уникален: почта — ключ входа
  const базовыйСлаг = слаг(клиника);
  let s = базовыйСлаг;
  for (let n = 2; ; n++) {
    const занят = await prisma.user.findFirst({
      where: { email: { startsWith: `demo-${s}-` } },
      select: { id: true },
    });
    if (!занят) break;
    s = `${базовыйСлаг}-${n}`;
  }

  const организация = await prisma.organization.create({
    data: {
      name: `Демо · ${клиника}`,
      industry: отрасль.toLowerCase().trim(),
      isDemo: true,
      demoTalksLimit: разговоров,
      hoursLimit: ПОТОЛОК_ЧАСОВ,
    },
  });
  console.log(`Организация: ${организация.name} (${организация.industry})`);

  // Отраслевой пресет: шаблонная организация с вычитанными случаями.
  // Копируем случаи, чтобы не генерировать под каждое демо за деньги
  const пресет = await prisma.organization.findFirst({
    where: { isPreset: true, industry: организация.industry },
    select: { id: true, name: true },
  });
  if (пресет) {
    // Прайс и диагнозы копируем вместе со случаями. Разговору они не нужны —
    // цены звучат из уст менеджера, — но руководитель демо-клиники первым
    // делом открывает «Клиника и услуги», и пустая форма там читается
    // как недоделанный продукт, хотя случаи на месте
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
          organizationId: организация.id,
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
          organizationId: организация.id,
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
          organizationId: организация.id,
          // Тип чтения Json допускает null, тип записи — нет: разводим явно
          caseData:
            c.caseData === null
              ? Prisma.JsonNull
              : (c.caseData as Prisma.InputJsonValue),
        })),
      });
    }
    console.log(
      `Пресет «${пресет.name}»: случаев ${случаи.length}, ` +
        `услуг ${услуги.length}, диагнозов ${диагнозы.length}`
    );
  } else if (разговоров) {
    // Собственнику доступ уходит прямо в переписке, без созвона и без нас
    // рядом. Тихий откат на глобальные офтальмологические промпты в чужой
    // отрасли он увидит сам — и это будет первое впечатление о продукте
    const отрасли = await prisma.organization.findMany({
      where: { isPreset: true },
      select: { industry: true },
      orderBy: { industry: "asc" },
    });
    await prisma.organization.delete({ where: { id: организация.id } });
    const список =
      отрасли.map((о) => `«${о.industry}»`).join(", ") || "ни одного";
    console.error(
      `\nПресета для отрасли «${организация.industry}» нет, а демо ` +
        "собственнику уходит без нас рядом — выдавать на чужих промптах " +
        `нельзя.\nЕсть пресеты: ${список}.\n` +
        "Собрать новый: npm run seed:presets."
    );
    process.exit(1);
  } else {
    console.log(
      `Пресета для отрасли «${организация.industry}» нет — выдаю на глобальных ` +
        `офтальмологических промптах. Демо работоспособно.`
    );
  }

  // Один аккаунт собственнику. Роль менеджера, а не руководителя: панель
  // отдела ему показывает Дима на созвоне, а пустая витрина после трёх
  // разговоров работает против нас
  if (разговоров) {
    const парольСобственника = пароль();
    const почта = `demo-${s}-owner@podhod.tech`;
    await prisma.user.create({
      data: {
        email: почта,
        passwordHash: await bcrypt.hash(парольСобственника, 10),
        firstName: "Гость",
        lastName: "Демо",
        role: "manager",
        clinic: клиника,
        organizationId: организация.id,
      },
    });

    console.log(`
-------------------------------------------------------
Доступ к тренажёру podhod.tech — «${клиника}»

Логин:   ${почта}
Пароль:  ${парольСобственника}

Вход: https://podhod.tech
Откройте в Chrome, говорить лучше в наушниках.

В доступе ${разговоров} ${разговорОв(разговоров)} с клиентами:
${ДЕМО_КЛИЕНТЫ.join(", ")}.
После каждого остаётся разбор — его можно перечитать
и показать коллегам.
-------------------------------------------------------`);
    return;
  }

  // Пара аккаунтов. РОП видит панель отдела и разборы, менеджер тренируется
  const парольРопа = пароль();
  const парольМенеджера = пароль();
  const почтаРопа = `demo-${s}-rop@podhod.tech`;
  const почтаМенеджера = `demo-${s}-manager@podhod.tech`;

  await prisma.user.create({
    data: {
      email: почтаРопа,
      passwordHash: await bcrypt.hash(парольРопа, 10),
      firstName: "Руководитель",
      lastName: "Демо",
      role: "head",
      jobTitle: "Руководитель отдела продаж",
      clinic: клиника,
      organizationId: организация.id,
    },
  });
  await prisma.user.create({
    data: {
      email: почтаМенеджера,
      passwordHash: await bcrypt.hash(парольМенеджера, 10),
      firstName: "Менеджер",
      lastName: "Демо",
      role: "manager",
      clinic: клиника,
      organizationId: организация.id,
    },
  });

  // Блок для пересылки Диме как есть
  console.log(`
-------------------------------------------------------
Доступ к тренажёру podhod.tech на сутки — «${клиника}»

Руководитель:  ${почтаРопа}
Пароль:        ${парольРопа}

Менеджер:      ${почтаМенеджера}
Пароль:        ${парольМенеджера}

Вход: https://podhod.tech
Откройте в Chrome, говорить лучше в наушниках.

Сутки отсчитываются с первого разговора. Разборы
останутся доступны и после — посмотрим их вместе.
-------------------------------------------------------`);
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
