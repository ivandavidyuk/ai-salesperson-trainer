// Демо-данные для показа продукта: аккаунт с заполненной главной.
// Запуск: npm run seed:demo
//         DEMO_PASSWORD=... npm run seed:demo
//
// Зачем: разбора звонков ещё нет, поэтому у реальных разговоров нет оценок,
// и блоки «Статистика» и «Прогресс» выглядели бы пустыми. Скрипт создаёт
// отдельный демо-аккаунт с историей разговоров и разборами.
//
// Безопасность: скрипт трогает ТОЛЬКО демо-аккаунт (по email ниже) и его
// разговоры — данные остальных пользователей не затрагиваются. Повторный
// запуск пересоздаёт историю заново, поэтому его можно гонять сколько угодно.
// Пароль не зашит в репозиторий: берётся из DEMO_PASSWORD либо генерируется
// случайным и печатается один раз при создании.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@podhod.tech";
const DEMO_FIRST_NAME = "Ирина";
const DEMO_LAST_NAME = "Петрова";

// Руководитель, от имени которого выданы задания демо-аккаунта.
// Своих страниц у роли пока нет, поэтому аккаунт нужен только как автор:
// заходить под ним некуда, пароль случайный и никуда не выводится.
const HEAD_EMAIL = "head@podhod.tech";
const HEAD_FIRST_NAME = "Сергей";
const HEAD_LAST_NAME = "Волков";

// Пациентов наливает seed-patients.ts — здесь только привязываем разговоры
const PATIENT_NAME = "Тамара Михайловна";

// Достижения демо-аккаунта: те же, что отмечены полученными в макете.
// daysAgo — когда получено, чтобы даты выглядели правдоподобно.
// Сами достижения наливает seed-achievements.ts.
const UNLOCKED_ACHIEVEMENTS = [
  { id: "first-contact", daysAgo: 24 },
  { id: "closer", daysAgo: 21 },
  { id: "scriptolog", daysAgo: 18 },
  { id: "no-lunch", daysAgo: 15 },
  { id: "detective", daysAgo: 12 },
  { id: "chatterbox", daysAgo: 11 },
  { id: "deaf", daysAgo: 10 },
  { id: "quickdraw", daysAgo: 8 },
  { id: "door-is-there", daysAgo: 6 },
  { id: "seller", daysAgo: 4 },
  { id: "triple-kill", daysAgo: 2 },
  { id: "fearless", daysAgo: 1 },
];

// Задания от руководителя: те же три, что в макете «Задания».
// dueInDays — срок относительно сегодняшнего дня, чтобы карточки не
// протухали при каждом запуске сида.
const ASSIGNMENTS = [
  {
    title: "Возражение по цене операции",
    trainingTypeId: "s4",
    dueInDays: 1,
    isPriority: true,
    comment:
      "Ирина, в трёх последних разговорах теряешь клиента на цене. " +
      "Отработай — отвечай выгодой, а не оправданием.",
  },
  {
    title: "Уточняющие вопросы на первой консультации",
    trainingTypeId: "s3",
    dueInDays: 3,
    isPriority: false,
    comment:
      "Больше открытых вопросов в начале — дай клиенту рассказать, " +
      "что его действительно беспокоит.",
  },
  {
    title: "Разговор от приветствия до записи на приём",
    trainingTypeId: "full",
    dueInDays: 5,
    isPriority: false,
    comment:
      "Контрольный прогон целиком. Свяжи всё, что тренировали, " +
      "в один спокойный разговор.",
  },
];

// Понедельник текущей недели, 00:00 — граница «этой недели» в статистике
function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  // getDay(): 0 — воскресенье, поэтому сдвигаем к понедельнику
  const dayIndex = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayIndex);
  return result;
}

interface DemoConversation {
  startedAt: Date;
  topic: string;
  durationSec: number;
  isFavorite: boolean;
  overallScore: number;
  contactScore: number;
  iceBreakerScore: number;
  needsScore: number;
  objectionsScore: number;
  strength: string;
  growthPoint: string;
}

// Разговоры этой недели: контакт и «топка льда» выше прошлой недели,
// выявление потребности и возражения — ниже. Так в блоке «Прогресс»
// видно и рост, и падение.
const THIS_WEEK = [
  {
    hoursAgo: 3,
    topic: "катаракта",
    durationSec: 278,
    isFavorite: true,
    overallScore: 10,
    contactScore: 8.1,
    iceBreakerScore: 7.2,
    needsScore: 6.0,
    objectionsScore: 5.2,
    strength: "Тёплый первый контакт — клиент быстро проникся доверием.",
    growthPoint: "Возражение по цене: отвечайте выгодой, а не оправданием.",
  },
  {
    hoursAgo: 27,
    topic: "очки для чтения",
    durationSec: 191,
    isFavorite: false,
    overallScore: 7.2,
    contactScore: 7.6,
    iceBreakerScore: 6.8,
    needsScore: 6.4,
    objectionsScore: 5.7,
    strength: "Спокойный темп речи, не давили на клиента.",
    growthPoint: "Мало уточняющих вопросов — потребность осталась размытой.",
  },
  {
    hoursAgo: 51,
    topic: "первая консультация",
    durationSec: 320,
    isFavorite: false,
    overallScore: 6.4,
    contactScore: 7.7,
    iceBreakerScore: 6.7,
    needsScore: 6.2,
    objectionsScore: 5.6,
    strength: "Хорошо объяснили, что будет происходить на приёме.",
    growthPoint: "Не проговорили следующий шаг — клиент ушёл без записи.",
  },
  {
    hoursAgo: 75,
    topic: "подбор линз",
    durationSec: 245,
    isFavorite: false,
    overallScore: 6.9,
    contactScore: 7.8,
    iceBreakerScore: 6.9,
    needsScore: 6.2,
    objectionsScore: 5.5,
    strength: "Говорили простым языком, без медицинских терминов.",
    growthPoint: "Стоит раньше переходить к вопросам о привычках клиента.",
  },
];

// Прошлая неделя — база для сравнения
const LAST_WEEK = [
  {
    dayOffset: 1,
    hour: 10,
    topic: "возражение по цене",
    durationSec: 174,
    isFavorite: false,
    overallScore: 5.8,
    contactScore: 7.1,
    iceBreakerScore: 5.6,
    needsScore: 6.7,
    objectionsScore: 6.4,
    strength: "Не растерялись при резком возражении.",
    growthPoint: "Слишком быстро назвали цену — до ценности услуги.",
  },
  {
    dayOffset: 2,
    hour: 15,
    topic: "повторный визит",
    durationSec: 290,
    isFavorite: true,
    overallScore: 8.3,
    contactScore: 7.4,
    iceBreakerScore: 5.9,
    needsScore: 6.5,
    objectionsScore: 6.2,
    strength: "Вспомнили детали прошлого разговора — клиенту приятно.",
    growthPoint: "Не предложили конкретную дату следующего визита.",
  },
  {
    dayOffset: 3,
    hour: 9,
    topic: "страх операции",
    durationSec: 335,
    isFavorite: false,
    overallScore: 5.2,
    contactScore: 7.0,
    iceBreakerScore: 5.5,
    needsScore: 6.6,
    objectionsScore: 6.3,
    strength: "Дали клиенту выговориться, не перебивали.",
    growthPoint: "Страх не отработан — нужны факты о безопасности операции.",
  },
  {
    dayOffset: 4,
    hour: 13,
    topic: "сравнение брендов",
    durationSec: 220,
    isFavorite: false,
    overallScore: 7.6,
    contactScore: 7.3,
    iceBreakerScore: 5.8,
    needsScore: 6.6,
    objectionsScore: 6.3,
    strength: "Чёткое сравнение вариантов без навязывания.",
    growthPoint: "Много деталей сразу — клиент потерял нить.",
  },
];

// Короткий диалог, чтобы страница расшифровки не была пустой
const SAMPLE_DIALOG: { role: "user" | "assistant"; text: string }[] = [
  { role: "user", text: "Добрый день! Меня зовут Ирина. Как я могу к вам обращаться?" },
  { role: "assistant", text: "Добрый день. Тамара Михайловна." },
  { role: "user", text: "Очень приятно. Расскажите, с чем вы к нам сегодня пришли?" },
  {
    role: "assistant",
    text: "Я на диагностику зрения. Очки для дали есть, а вблизи читать стало трудно.",
  },
];

function buildConversations(): DemoConversation[] {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const result: DemoConversation[] = [];

  // Эта неделя: отсчитываем назад от «сейчас» и оставляем только то,
  // что не выпало за понедельник — иначе в начале недели разговоры
  // уехали бы в прошлую и статистика «на этой неделе» была бы неверной.
  for (const item of THIS_WEEK) {
    const startedAt = new Date(now.getTime() - item.hoursAgo * 3600_000);
    if (startedAt < weekStart) continue;
    const { hoursAgo, ...rest } = item;
    void hoursAgo;
    result.push({ ...rest, startedAt });
  }

  // Прошлая неделя: привязываемся к её понедельнику, попадание гарантировано
  for (const item of LAST_WEEK) {
    const startedAt = new Date(lastWeekStart);
    startedAt.setDate(startedAt.getDate() + item.dayOffset);
    startedAt.setHours(item.hour, 0, 0, 0);
    const { dayOffset, hour, ...rest } = item;
    void dayOffset;
    void hour;
    result.push({ ...rest, startedAt });
  }

  return result;
}

async function main() {
  console.log("=== Демо-данные ===\n");

  // 1. Пациент. Самих пациентов наливает seed-patients.ts — здесь только
  // находим того, к кому привязать демо-разговоры.
  const patient = await prisma.patient.findFirst({ where: { name: PATIENT_NAME } });
  if (!patient) {
    console.error(
      `Пациент «${PATIENT_NAME}» не найден.\n` +
        "Сначала выполните: npm run seed:patients"
    );
    process.exit(1);
  }
  console.log(`Пациент разговоров: ${patient.name}`);

  // 2. Демо-пользователь
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  const password = process.env.DEMO_PASSWORD || randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { firstName: DEMO_FIRST_NAME, lastName: DEMO_LAST_NAME, passwordHash },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      firstName: DEMO_FIRST_NAME,
      lastName: DEMO_LAST_NAME,
    },
  });
  console.log(`${existing ? "Обновлён" : "Создан"} аккаунт: ${user.email}`);

  // 3. Разговоры пересоздаём: так повторный запуск даёт предсказуемый
  // результат, а даты всегда попадают в текущую и прошлую неделю.
  const removed = await prisma.session.deleteMany({ where: { userId: user.id } });
  if (removed.count > 0) {
    console.log(`Удалено старых демо-разговоров: ${removed.count}`);
  }

  const conversations = buildConversations();
  for (const item of conversations) {
    const endedAt = new Date(item.startedAt.getTime() + item.durationSec * 1000);
    await prisma.session.create({
      data: {
        userId: user.id,
        patientId: patient.id,
        status: "completed",
        topic: item.topic,
        durationSec: item.durationSec,
        isFavorite: item.isFavorite,
        startedAt: item.startedAt,
        endedAt,
        messages: {
          create: SAMPLE_DIALOG.map((message, index) => ({
            role: message.role,
            text: message.text,
            createdAt: new Date(item.startedAt.getTime() + index * 15_000),
          })),
        },
        review: {
          create: {
            overallScore: item.overallScore,
            contactScore: item.contactScore,
            iceBreakerScore: item.iceBreakerScore,
            needsScore: item.needsScore,
            objectionsScore: item.objectionsScore,
            strength: item.strength,
            growthPoint: item.growthPoint,
            createdAt: endedAt,
          },
        },
      },
    });
  }

  console.log(`Создано разговоров: ${conversations.length}`);

  // 4. Задания от руководителя. Аккаунт руководителя нужен только как автор:
  // своих страниц у роли пока нет, поэтому пароль случайный и не выводится.
  const head = await prisma.user.upsert({
    where: { email: HEAD_EMAIL },
    update: { firstName: HEAD_FIRST_NAME, lastName: HEAD_LAST_NAME, role: "head" },
    create: {
      email: HEAD_EMAIL,
      passwordHash: await bcrypt.hash(randomBytes(24).toString("base64url"), 10),
      firstName: HEAD_FIRST_NAME,
      lastName: HEAD_LAST_NAME,
      role: "head",
    },
  });

  // Пересоздаём: сроки заданий отсчитываются от сегодняшнего дня
  await prisma.assignment.deleteMany({ where: { userId: user.id } });

  const midnight = new Date();
  midnight.setHours(23, 59, 59, 0);
  let createdAssignments = 0;
  for (const item of ASSIGNMENTS) {
    // Тип тренировки должен существовать — иначе внешний ключ не встанет
    const type = await prisma.trainingType.findUnique({
      where: { id: item.trainingTypeId },
    });
    if (!type) {
      console.error(
        `Тип тренировки «${item.trainingTypeId}» не найден.\n` +
          "Сначала выполните: npm run seed:training"
      );
      process.exit(1);
    }
    const dueAt = new Date(midnight);
    dueAt.setDate(dueAt.getDate() + item.dueInDays);
    await prisma.assignment.create({
      data: {
        userId: user.id,
        createdById: head.id,
        patientId: patient.id,
        trainingTypeId: type.id,
        title: item.title,
        comment: item.comment,
        dueAt,
        isPriority: item.isPriority,
      },
    });
    createdAssignments += 1;
  }
  console.log(`Создано заданий: ${createdAssignments} (автор — ${head.firstName} ${head.lastName})`);

  // 5. Полученные достижения. Механизма выдачи нет — проставляем сидом.
  await prisma.userAchievement.deleteMany({ where: { userId: user.id } });

  let unlocked = 0;
  for (const item of UNLOCKED_ACHIEVEMENTS) {
    const achievement = await prisma.achievement.findUnique({
      where: { id: item.id },
    });
    if (!achievement) {
      console.error(
        `Достижение «${item.id}» не найдено.\n` +
          "Сначала выполните: npm run seed:achievements"
      );
      process.exit(1);
    }
    const unlockedAt = new Date();
    unlockedAt.setDate(unlockedAt.getDate() - item.daysAgo);
    await prisma.userAchievement.create({
      data: { userId: user.id, achievementId: achievement.id, unlockedAt },
    });
    unlocked += 1;
  }
  const totalAchievements = await prisma.achievement.count();
  console.log(`Выдано достижений: ${unlocked} из ${totalAchievements}`);

  console.log("\nВход в демо-аккаунт:");
  console.log(`  email:  ${DEMO_EMAIL}`);
  if (process.env.DEMO_PASSWORD) {
    console.log("  пароль: (из переменной окружения DEMO_PASSWORD)");
  } else {
    console.log(`  пароль: ${password}`);
    console.log("\nПароль сгенерирован случайно и показан один раз — сохраните его.");
    console.log("Чтобы задать свой: DEMO_PASSWORD=... npm run seed:demo");
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
