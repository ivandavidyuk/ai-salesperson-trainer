// Типы тренировки для мастера настройки.
// Запуск: npm run seed:training
//
// Поле prompt — добавка к промпту пациента: она объясняет LLM, какой этап
// сделки сейчас отрабатывается. Backend склеивает их в один системный промпт.
//
// Промпты живут здесь, а не в БД: источник правды — репозиторий, изменения
// видны в истории git. Поэтому скрипт ПЕРЕЗАПИСЫВАЕТ промпты при каждом
// запуске — правки, сделанные напрямую в базе, будут потеряны.
//
// Сейчас все шесть промптов — временные заглушки в одно-два предложения.

import { PrismaClient, TrainingGroup } from "@prisma/client";

const prisma = new PrismaClient();

interface TrainingTypeSeed {
  id: string;
  title: string;
  description: string;
  group: TrainingGroup;
  prompt: string;
  position: number;
}

// TODO: все промпты ниже — временные заглушки, их предстоит написать
export const TRAINING_TYPES: TrainingTypeSeed[] = [
  {
    id: "full",
    title: "Полный разговор",
    description: "Все четыре этапа подряд — от приветствия до закрытия",
    group: TrainingGroup.full,
    prompt:
      "Разговор идёт целиком: от приветствия до закрытия, все этапы подряд. " +
      "Веди себя естественно и не подсказывай менеджеру, на каком этапе вы находитесь.",
    position: 1,
  },
  {
    id: "s1",
    title: "Установка контакта",
    description: "Приветствие, представление, цель",
    group: TrainingGroup.stage,
    prompt:
      "Отрабатывается только начало разговора: приветствие, знакомство и цель визита. " +
      "К обсуждению лечения и цен не переходи.",
    position: 2,
  },
  {
    id: "s2",
    title: "Растопить лёд",
    description: "Снять напряжение, тёплый тон",
    group: TrainingGroup.stage,
    prompt:
      "Отрабатывается снятие напряжения в начале разговора. Держись слегка " +
      "настороженно и теплей только в ответ на спокойный доброжелательный тон.",
    position: 3,
  },
  {
    id: "s3",
    title: "Выявление потребности",
    description: "Вопросы и активное слушание",
    group: TrainingGroup.stage,
    prompt:
      "Отрабатывается выявление потребности. Сам о своей проблеме подробно не " +
      "рассказывай — раскрывайся ровно настолько, насколько менеджер спрашивает.",
    position: 4,
  },
  {
    id: "s4",
    title: "Отработка возражений",
    description: "Ответы на сомнения клиента",
    group: TrainingGroup.stage,
    prompt:
      "Отрабатываются возражения. Сомневайся активнее обычного и не соглашайся " +
      "с первого ответа — принимай аргумент, только если он тебя действительно убедил.",
    position: 5,
  },
  {
    id: "intercept",
    title: "Перехват инициативы",
    description: "Мягко вернуть управление беседой и удержать структуру",
    group: TrainingGroup.special,
    prompt:
      "Отрабатывается перехват инициативы. Уводи разговор в сторону, задавай " +
      "встречные вопросы и перебивай тему — пусть менеджер учится возвращать управление беседой.",
    position: 6,
  },
];

async function main() {
  console.log("=== Типы тренировки ===\n");

  for (const item of TRAINING_TYPES) {
    // id — стабильный слаг, поэтому upsert без поиска по имени
    await prisma.trainingType.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
    console.log(`${item.id.padEnd(10)} ${item.title} · ${item.prompt.length} символов промпта`);
  }

  console.log(`\nВсего типов: ${TRAINING_TYPES.length}`);
  console.log("Промпты перезаписаны значениями из этого файла.");
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
