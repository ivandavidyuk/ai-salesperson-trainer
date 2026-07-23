// Демо-менеджеры отдела для страницы «Статистика» руководителя.
// Запуск: npm run seed:team
//         TEAM_PASSWORD=... npm run seed:team
//
// Зачем: разговоры и оценки есть только у демо-аккаунта, поэтому статистика
// по отделу состояла бы из одной строки. Скрипт заводит трёх менеджеров
// с разной историей — сильного, среднего и новичка.
//
// Безопасность: трогает ТОЛЬКО эти три аккаунта (по email ниже). Аккаунты
// Ивана и Дмитрия не затрагиваются — на них идёт живое тестирование, и
// выдуманные разговоры там мешали бы.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

// Понедельник текущей недели, 00:00 — граница «этой недели» в статистике
function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const dayIndex = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayIndex);
  return result;
}

interface Conversation {
  /** Часы назад для этой недели либо смещение от понедельника прошлой */
  hoursAgo?: number;
  dayOffset?: number;
  hour?: number;
  topic: string;
  durationSec: number;
  overallScore: number;
  contactScore: number;
  iceBreakerScore: number;
  needsScore: number;
  objectionsScore: number;
}

interface TeamMember {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  strength: string;
  growthPoint: string;
  thisWeek: Conversation[];
  lastWeek: Conversation[];
}

// Профили специально разные: у Ольги рост по всем этапам, у Павла падение
// на возражениях — иначе дельты в раскрытой карточке были бы нулевыми
// и проверить их не вышло бы.
export const TEAM: TeamMember[] = [
  {
    email: "alexey.morozov@podhod.tech",
    firstName: "Алексей",
    lastName: "Морозов",
    jobTitle: "Менеджер по продажам",
    strength: "Чёткая структура разговора, уверенно ведёт клиента к цели.",
    growthPoint: "Больше эмпатии в начале — не спешить сразу к делу.",
    thisWeek: [
      { hoursAgo: 5, topic: "глаукома", durationSec: 228, overallScore: 7.5, contactScore: 7.1, iceBreakerScore: 6.4, needsScore: 7.0, objectionsScore: 6.5 },
      { hoursAgo: 29, topic: "контроль давления", durationSec: 200, overallScore: 6.8, contactScore: 7.0, iceBreakerScore: 6.5, needsScore: 6.9, objectionsScore: 6.6 },
      { hoursAgo: 53, topic: "повторный визит", durationSec: 242, overallScore: 6.1, contactScore: 7.2, iceBreakerScore: 6.3, needsScore: 7.1, objectionsScore: 6.4 },
    ],
    lastWeek: [
      { dayOffset: 1, hour: 11, topic: "капли и режим", durationSec: 178, overallScore: 7.0, contactScore: 6.8, iceBreakerScore: 5.9, needsScore: 6.2, objectionsScore: 6.3 },
      { dayOffset: 2, hour: 14, topic: "первая консультация", durationSec: 215, overallScore: 6.5, contactScore: 6.7, iceBreakerScore: 5.8, needsScore: 6.1, objectionsScore: 6.2 },
      { dayOffset: 4, hour: 10, topic: "диагностика", durationSec: 190, overallScore: 6.9, contactScore: 6.9, iceBreakerScore: 6.0, needsScore: 6.3, objectionsScore: 6.4 },
    ],
  },
  {
    email: "olga.kovaleva@podhod.tech",
    firstName: "Ольга",
    lastName: "Ковалёва",
    jobTitle: "Старший менеджер",
    strength: "Стабильно высокие оценки на всех этапах, лидер отдела.",
    growthPoint: "Иногда затягивает разговор — работать над лаконичностью.",
    thisWeek: [
      { hoursAgo: 4, topic: "близорукость", durationSec: 302, overallScore: 8.7, contactScore: 8.4, iceBreakerScore: 8.0, needsScore: 8.2, objectionsScore: 7.6 },
      { hoursAgo: 26, topic: "подбор линз", durationSec: 288, overallScore: 8.3, contactScore: 8.5, iceBreakerScore: 8.1, needsScore: 8.3, objectionsScore: 7.7 },
      { hoursAgo: 50, topic: "сухость глаз", durationSec: 252, overallScore: 7.9, contactScore: 8.3, iceBreakerScore: 7.9, needsScore: 8.1, objectionsScore: 7.5 },
      { hoursAgo: 74, topic: "возражение по цене", durationSec: 330, overallScore: 8.0, contactScore: 8.4, iceBreakerScore: 8.0, needsScore: 8.2, objectionsScore: 7.6 },
    ],
    lastWeek: [
      { dayOffset: 1, hour: 9, topic: "повторный визит", durationSec: 295, overallScore: 8.4, contactScore: 8.0, iceBreakerScore: 7.4, needsScore: 7.9, objectionsScore: 6.7 },
      { dayOffset: 3, hour: 13, topic: "первая консультация", durationSec: 310, overallScore: 7.6, contactScore: 7.9, iceBreakerScore: 7.3, needsScore: 7.8, objectionsScore: 6.6 },
      { dayOffset: 4, hour: 16, topic: "страх операции", durationSec: 275, overallScore: 8.1, contactScore: 8.1, iceBreakerScore: 7.5, needsScore: 8.0, objectionsScore: 6.8 },
    ],
  },
  {
    email: "pavel.drozdov@podhod.tech",
    firstName: "Павел",
    lastName: "Дроздов",
    jobTitle: "Менеджер по продажам",
    strength: "Быстро осваивается, растёт от разговора к разговору.",
    growthPoint: "Отработка возражений — тренировать спокойные ответы на «дорого».",
    thisWeek: [
      { hoursAgo: 7, topic: "ретинопатия", durationSec: 190, overallScore: 5.2, contactScore: 6.2, iceBreakerScore: 5.4, needsScore: 6.0, objectionsScore: 4.8 },
      { hoursAgo: 31, topic: "первый звонок", durationSec: 165, overallScore: 6.1, contactScore: 6.3, iceBreakerScore: 5.5, needsScore: 6.1, objectionsScore: 4.9 },
    ],
    lastWeek: [
      { dayOffset: 2, hour: 12, topic: "страх операции", durationSec: 220, overallScore: 5.5, contactScore: 5.7, iceBreakerScore: 5.7, needsScore: 5.3, objectionsScore: 5.4 },
      { dayOffset: 3, hour: 15, topic: "диагностика", durationSec: 150, overallScore: 6.0, contactScore: 5.9, iceBreakerScore: 5.8, needsScore: 5.4, objectionsScore: 5.3 },
    ],
  },
];

// Короткий диалог, чтобы расшифровка не была пустой
const SAMPLE_DIALOG: { role: "user" | "assistant"; text: string }[] = [
  { role: "user", text: "Здравствуйте! Меня зовут менеджер клиники. Как к вам обращаться?" },
  { role: "assistant", text: "Здравствуйте. Можно просто по имени." },
  { role: "user", text: "Расскажите, что вас беспокоит?" },
  { role: "assistant", text: "Зрение стало хуже, хочу проверить и понять, что делать дальше." },
];

async function main() {
  console.log("=== Менеджеры отдела ===\n");

  const patient = await prisma.patient.findFirst({ where: { isActive: true } });
  if (!patient) {
    console.error(
      "Активный пациент не найден.\nСначала выполните: npm run seed:patients"
    );
    process.exit(1);
  }

  const password = process.env.TEAM_PASSWORD || randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);

  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  for (const member of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: member.email },
      update: {
        firstName: member.firstName,
        lastName: member.lastName,
        jobTitle: member.jobTitle,
        role: "manager",
        passwordHash,
      },
      create: {
        email: member.email,
        passwordHash,
        firstName: member.firstName,
        lastName: member.lastName,
        jobTitle: member.jobTitle,
        role: "manager",
      },
    });

    // Пересоздаём: даты считаются от сегодняшнего дня, иначе при повторном
    // запуске разговоры уехали бы в прошлое и «за неделю» обнулилось
    await prisma.session.deleteMany({ where: { userId: user.id } });

    const items: { conversation: Conversation; startedAt: Date }[] = [];

    for (const conversation of member.thisWeek) {
      const startedAt = new Date(now.getTime() - (conversation.hoursAgo ?? 0) * 3600_000);
      // В начале недели часть разговоров выпала бы в прошлую и статистика
      // «за неделю» врала бы
      if (startedAt < weekStart) continue;
      items.push({ conversation, startedAt });
    }

    for (const conversation of member.lastWeek) {
      const startedAt = new Date(lastWeekStart);
      startedAt.setDate(startedAt.getDate() + (conversation.dayOffset ?? 0));
      startedAt.setHours(conversation.hour ?? 12, 0, 0, 0);
      items.push({ conversation, startedAt });
    }

    for (const { conversation, startedAt } of items) {
      const endedAt = new Date(startedAt.getTime() + conversation.durationSec * 1000);
      await prisma.session.create({
        data: {
          userId: user.id,
          patientId: patient.id,
          status: "completed",
          topic: conversation.topic,
          durationSec: conversation.durationSec,
          startedAt,
          endedAt,
          messages: {
            create: SAMPLE_DIALOG.map((message, index) => ({
              role: message.role,
              text: message.text,
              createdAt: new Date(startedAt.getTime() + index * 15_000),
            })),
          },
          review: {
            create: {
              overallScore: conversation.overallScore,
              contactScore: conversation.contactScore,
              iceBreakerScore: conversation.iceBreakerScore,
              needsScore: conversation.needsScore,
              objectionsScore: conversation.objectionsScore,
              strength: member.strength,
              growthPoint: member.growthPoint,
              createdAt: endedAt,
            },
          },
        },
      });
    }

    console.log(
      `${member.firstName} ${member.lastName} · ${items.length} разговоров · ${member.email}`
    );
  }

  console.log("\nВход для всех трёх:");
  if (process.env.TEAM_PASSWORD) {
    console.log("  пароль: (из переменной окружения TEAM_PASSWORD)");
  } else {
    console.log(`  пароль: ${password}`);
    console.log("\nПароль сгенерирован случайно и показан один раз — сохраните его.");
    console.log("Чтобы задать свой: TEAM_PASSWORD=... npm run seed:team");
  }
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
