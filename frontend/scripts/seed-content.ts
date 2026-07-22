// Наполнение таблицы DailyContent: «Совет дня» и «Мотивация».
// Запуск: npm run seed:content
//
// Это продовый контент, а не тестовые данные: тексты видят все пользователи.
// На главной элемент выбирается по индексу дня (день % количество), поэтому
// достаточно просто держать здесь список в нужном порядке — чем он длиннее,
// тем реже повторяется. Скрипт идемпотентный: повторный запуск обновит тексты
// на тех же позициях, а не наплодит дубли.

import { PrismaClient, DailyContentKind } from "@prisma/client";

const prisma = new PrismaClient();

// Порядок в массиве = порядок ротации по дням.
const TIPS: string[] = [
  "Держи фокус на выгоде, а не на страхе: «Вы получите не просто услугу, а понятный результат».",
];

const MOTIVATIONS: string[] = [
  "Деньги — это отражение твоей пользы. Сегодня дай максимум пользы — и результат не заставит себя ждать.",
];

// Записывает список текстов одного вида, проставляя позиции по порядку
async function seedKind(kind: DailyContentKind, texts: string[]) {
  for (const [position, text] of texts.entries()) {
    await prisma.dailyContent.upsert({
      where: { kind_position: { kind, position } },
      update: { text, isActive: true },
      create: { kind, position, text },
    });
  }
  return texts.length;
}

async function main() {
  console.log("=== Наполнение ежедневного контента ===\n");

  const tips = await seedKind(DailyContentKind.tip, TIPS);
  const motivations = await seedKind(DailyContentKind.motivation, MOTIVATIONS);

  console.log(`Советов дня:  ${tips}`);
  console.log(`Мотиваций:    ${motivations}`);
  console.log("\nГотово. Тексты меняются раз в сутки по индексу дня.");
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
