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
//    и копирует её случаи (scripts/demo-clinic.ts). Пресета нет —
//    отказывает в любом режиме: без случаев разговоры не начнутся.
// 3. Создаёт аккаунты со случайными паролями и печатает блок,
//    который целиком пересылается Диме.

import { PrismaClient } from "@prisma/client";
import { демоКлиенты } from "../lib/demoScope";
import { скопироватьПресет } from "./demo-clinic";
import { plural } from "../lib/format";
import bcrypt from "bcryptjs";
import { пароль } from "./password";

const prisma = new PrismaClient();

/** Потолок расхода демо-организации, часов. Аварийный, клиенту не называется */
const ПОТОЛОК_ЧАСОВ = 3;

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
  const пресет = await скопироватьПресет(prisma, организация.id, организация.industry);
  if (пресет) {
    console.log(
      `Пресет «${пресет.имя}»: случаев ${пресет.случаев}, ` +
        `услуг ${пресет.услуг}, диагнозов ${пресет.диагнозов}`
    );
  } else {
    // Без пресета у демо нет ни одного случая, и разговор не начнётся:
    // глобальных промптов у пациентов больше нет (16.09)
    const отрасли = await prisma.organization.findMany({
      where: { isPreset: true },
      select: { industry: true },
      orderBy: { industry: "asc" },
    });
    await prisma.organization.delete({ where: { id: организация.id } });
    const список =
      отрасли.map((о) => `«${о.industry}»`).join(", ") || "ни одного";
    console.error(
      `\nПресета для отрасли «${организация.industry}» нет — без него ` +
        `у демо нет случаев, и разговоры не начнутся.\nЕсть пресеты: ${список}.\n` +
        "Собрать новый: npm run seed:presets."
    );
    process.exit(1);
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
${демоКлиенты(пресет.отрасль).join(", ")}.
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
