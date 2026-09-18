// Заливка типов тренировки в базу. Запуск: npm run seed:training
//
// Сами типы — тексты роли, рубрики, критерии и их отраслевые варианты —
// в training-types.ts. Скрипт ПЕРЕЗАПИСЫВАЕТ их при каждом запуске:
// источник правды — репозиторий, правки напрямую в базе будут потеряны.

import { PrismaClient } from "@prisma/client";
import { TRAINING_TYPES } from "./training-types";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Типы тренировки ===\n");

  for (const item of TRAINING_TYPES) {
    // Варианты по отрасли идут в JSON-колонки; в самой записи этих полей нет
    const { prompts, rubrics, doneWhens, ...поля } = item;
    const строка = {
      ...поля,
      promptByIndustry: prompts ?? {},
      rubricByIndustry: rubrics ?? {},
      doneWhenByIndustry: doneWhens ?? {},
    };
    // id — стабильный слаг, поэтому upsert без поиска по имени
    await prisma.trainingType.upsert({
      where: { id: item.id },
      update: строка,
      create: строка,
    });
    const оценка = item.scoresDeal ? "сделка" : "этап";
    console.log(
      `${item.id.padEnd(11)} ${item.title.padEnd(24)} ${оценка.padEnd(7)} ` +
        `промпт ${String(item.prompt.length).padStart(4)}` +
        (prompts ? ` · отрасли: ${Object.keys(prompts).join(", ")}` : "")
    );
  }

  console.log(`\nВсего типов: ${TRAINING_TYPES.length}`);
  console.log("Промпты, рубрики и описания перезаписаны значениями из этого файла.");
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
