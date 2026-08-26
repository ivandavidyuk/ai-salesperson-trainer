// Выдача демо-доступа: организация на сутки и пара аккаунтов РОП + менеджер.
// Запуск (неинтерактивный, для docker exec):
//
//   npm run create-demo -- --clinic "Улыбка" --industry стоматология
//
// Что делает:
// 1. Создаёт организацию «Демо · Улыбка»: isDemo, потолок hoursLimit = 3.
//    Сутки начнут тикать с ПЕРВОГО разговора (lib/demoAccess.ts), не с выдачи.
// 2. Ищет отраслевой пресет — организацию isPreset с той же отраслью —
//    и копирует её случаи. Пресета нет — честно говорит об этом и выдаёт
//    на глобальных промптах (они офтальмологические): демо работоспособно.
// 3. Создаёт два аккаунта со случайными паролями и печатает блок,
//    который целиком пересылается Диме.

import { Prisma, PrismaClient } from "@prisma/client";
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

function аргумент(имя: string): string | null {
  const i = process.argv.indexOf(`--${имя}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const клиника = аргумент("clinic");
  const отрасль = аргумент("industry");
  if (!клиника || !отрасль) {
    console.error(
      'Использование: npm run create-demo -- --clinic "Улыбка" --industry стоматология'
    );
    process.exit(1);
  }

  console.log("=== Демо-доступ на сутки ===\n");

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
        data: случаи.map((c) => ({
          patientId: c.patientId,
          organizationId: организация.id,
          prompt: c.prompt,
          // Тип чтения Json допускает null, тип записи — нет: разводим явно
          caseData:
            c.caseData === null
              ? Prisma.JsonNull
              : (c.caseData as Prisma.InputJsonValue),
          description: c.description,
          anamnesis: c.anamnesis,
          objections: c.objections,
          reviewNote: c.reviewNote,
        })),
      });
    }
    console.log(
      `Пресет «${пресет.name}»: случаев ${случаи.length}, ` +
        `услуг ${услуги.length}, диагнозов ${диагнозы.length}`
    );
  } else {
    console.log(
      `Пресета для отрасли «${организация.industry}» нет — выдаю на глобальных ` +
        `офтальмологических промптах. Демо работоспособно.`
    );
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
