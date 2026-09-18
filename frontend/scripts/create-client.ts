// Заведение клиента на полный доступ — вручную, нами.
//
//   npm run create-client -- --company "ЖК Северный" --industry недвижимость \
//     --city Казань --head "rop@sever.ru=Ирина Соколова" \
//     --manager "m1@sever.ru=Алексей Петров" --manager "m2@sever.ru"
//
// Зачем отдельный скрипт. У неклиник клиенты не собираются из прайса:
// генерация для них закрыта (lib/industry.ts), и организация, заведённая
// формой руководителя, осталась бы без единого клиента. Единственный
// источник случаев — отраслевой пресет. Его копирует и create-demo, но
// в демо-организацию с сутками и замками; этот скрипт — в полную.
// Клиникам он тоже годится: случаи из пресета потом пересоберутся под
// свой прайс штатно, из кабинета руководителя.
//
// Что делает:
// 1. До записи в базу проверяет, что пресет отрасли есть, а почты свободны:
//    иначе на полпути осталась бы организация без аккаунтов.
// 2. Создаёт организацию: не демо, лимит часов — --hours или по схеме.
// 3. Копирует пресет: прайс, диагнозы (у клиник) и случаи.
// 4. Заводит руководителя и менеджеров со случайными паролями и печатает
//    блок для пересылки клиенту.
//
// Почта — «адрес=Имя Фамилия», имя необязательно: без него аккаунт
// называется «Руководитель» или «Менеджер», человек поправит себя в профиле.

import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { скопироватьПресет } from "./demo-clinic";
import { пароль } from "./password";

const prisma = new PrismaClient();

interface Человек {
  email: string;
  firstName: string;
  lastName: string;
}

function аргумент(имя: string): string | null {
  const i = process.argv.indexOf(`--${имя}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Все значения повторяемого флага: --manager a --manager b */
function аргументы(имя: string): string[] {
  const значения: string[] = [];
  process.argv.forEach((арг, i) => {
    if (арг === `--${имя}` && process.argv[i + 1]) значения.push(process.argv[i + 1]);
  });
  return значения;
}

/** «rop@sever.ru=Ирина Соколова» → почта и имя; без имени — подпись роли */
function человек(запись: string, подпись: string): Человек {
  const [адрес, имя = ""] = запись.split("=");
  const email = адрес.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`Не похоже на почту: «${адрес}»`);
    process.exit(1);
  }
  const [first, ...rest] = имя.trim().split(/\s+/).filter(Boolean);
  return { email, firstName: first ?? подпись, lastName: rest.join(" ") };
}

async function main() {
  const компания = аргумент("company");
  const отрасль = аргумент("industry")?.toLowerCase().trim() ?? null;
  const город = аргумент("city");
  const часы = аргумент("hours");
  const главный = аргумент("head");
  const менеджеры = аргументы("manager");
  if (!компания || !отрасль || !главный) {
    console.error(
      'Использование: npm run create-client -- --company "ЖК Северный" ' +
        '--industry недвижимость --head "rop@sever.ru=Ирина Соколова" ' +
        '[--manager "m1@sever.ru=Алексей Петров" ...] [--city Казань] [--hours 60]'
    );
    process.exit(1);
  }
  const лимит = часы === null ? undefined : Number(часы);
  if (лимит !== undefined && (!Number.isInteger(лимит) || лимит < 1)) {
    console.error("--hours должен быть целым числом больше нуля");
    process.exit(1);
  }

  const руководитель = человек(главный, "Руководитель");
  const команда = менеджеры.map((м) => человек(м, "Менеджер"));
  const все = [руководитель, ...команда];

  // Проверки до первой записи: пресет и свободные почты
  const пресет = await prisma.organization.findFirst({
    where: { isPreset: true, industry: отрасль },
    select: { id: true },
  });
  if (!пресет) {
    const отрасли = await prisma.organization.findMany({
      where: { isPreset: true },
      select: { industry: true },
      orderBy: { industry: "asc" },
    });
    console.error(
      `Пресета для отрасли «${отрасль}» нет — без него у клиента не будет случаев.\n` +
        `Есть пресеты: ${отрасли.map((о) => `«${о.industry}»`).join(", ") || "ни одного"}.`
    );
    process.exit(1);
  }
  const повторы = new Set<string>();
  for (const ч of все) {
    if (повторы.has(ч.email)) {
      console.error(`Почта ${ч.email} указана дважды`);
      process.exit(1);
    }
    повторы.add(ч.email);
  }
  const занятые = await prisma.user.findMany({
    where: { email: { in: все.map((ч) => ч.email) } },
    select: { email: true },
  });
  if (занятые.length > 0) {
    console.error(`Почта уже занята: ${занятые.map((з) => з.email).join(", ")}`);
    process.exit(1);
  }

  console.log(`=== Клиент на полный доступ: «${компания}» ===\n`);

  const организация = await prisma.organization.create({
    data: {
      name: компания,
      industry: отрасль,
      city: город,
      ...(лимит !== undefined ? { hoursLimit: лимит } : {}),
    },
  });
  const копия = await скопироватьПресет(prisma, организация.id, отрасль);
  console.log(
    `Организация: ${организация.name} (${организация.industry}, ключ «${копия?.отрасль}»), ` +
      `лимит ${организация.hoursLimit} ч в месяц`
  );
  console.log(
    `Пресет «${копия?.имя}»: случаев ${копия?.случаев}, ` +
      `позиций прайса ${копия?.услуг}, диагнозов ${копия?.диагнозов}`
  );

  const пароли = new Map<string, string>();
  for (const [i, ч] of все.entries()) {
    const п = пароль();
    пароли.set(ч.email, п);
    await prisma.user.create({
      data: {
        email: ч.email,
        passwordHash: await bcrypt.hash(п, 10),
        firstName: ч.firstName,
        lastName: ч.lastName,
        role: i === 0 ? UserRole.head : UserRole.manager,
        jobTitle: i === 0 ? "Руководитель отдела продаж" : null,
        clinic: компания,
        organizationId: организация.id,
      },
    });
  }

  // Блок для пересылки клиенту как есть
  const строки = [
    `Руководитель:  ${руководитель.email}`,
    `Пароль:        ${пароли.get(руководитель.email)}`,
    ...команда.flatMap((ч) => ["", `Менеджер:      ${ч.email}`, `Пароль:        ${пароли.get(ч.email)}`]),
  ];
  console.log(`
-------------------------------------------------------
Доступ к тренажёру podhod.tech — «${компания}»

${строки.join("\n")}

Вход: https://podhod.tech
Откройте в Chrome, говорить лучше в наушниках.
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
