// Достижения — игровые бейджи за прогресс в тренировках.
// Запуск: npm run seed:achievements
//
// Список общий для всех пользователей; кто что получил, лежит в
// UserAchievement и проставляется сидом демо-аккаунта (механизма выдачи
// пока нет).
//
// Как и остальные сиды, скрипт ПЕРЕЗАПИСЫВАЕТ записи: источник правды —
// этот файл, а не база.
//
// Поле icon — ключ иконки, сами SVG лежат в app/achievements/page.tsx.

import { PrismaClient, AchievementTone } from "@prisma/client";

const prisma = new PrismaClient();

interface AchievementSeed {
  id: string;
  name: string;
  description: string;
  icon: string;
  tone: AchievementTone;
}

const { skill, gold, fun } = AchievementTone;

// Порядок в массиве = порядок в сетке на странице
export const ACHIEVEMENTS: AchievementSeed[] = [
  { id: "first-contact", name: "Есть контакт", description: "Завершить первый диалог с пациентом", icon: "contact", tone: skill },
  { id: "closer", name: "Закрыватель", description: "Закрыть первую сделку", icon: "check", tone: skill },
  { id: "triple-kill", name: "Трипл килл", description: "Закрыть 3 сделки", icon: "triple", tone: skill },
  { id: "rampage", name: "Рэмпейдж", description: "Закрыть 5 сделок", icon: "flame", tone: skill },
  { id: "scriptolog", name: "Скриптолог", description: "Полностью пройти скрипт разговора", icon: "script", tone: skill },
  { id: "quickdraw", name: "Скорострел", description: "Закрыть сделку быстрее чем за 25 минут", icon: "bolt", tone: skill },
  { id: "objection-slayer", name: "F*ck the objection", description: "Отработать 15 возражений", icon: "shield", tone: skill },
  { id: "fearless", name: "Без страха", description: "Провести более 50 тренировок", icon: "infinity", tone: skill },
  { id: "kenny", name: "Они убили Кенни", description: "Закрыть одного и того же персонажа 5 раз", icon: "skull", tone: fun },
  { id: "king-of-the-hill", name: "Царь горы", description: "Первое место в топе за месяц", icon: "crown", tone: gold },
  { id: "detective", name: "Детектив", description: "Выявить все потребности пациента", icon: "search", tone: skill },
  { id: "preemptive", name: "Без защиты", description: "Профилактировать все возражения", icon: "shieldx", tone: skill },
  { id: "terminator", name: "Терминатор", description: "Закрыть пациента после 3 возражений подряд", icon: "target", tone: skill },
  { id: "no-lunch", name: "Сегодня без обеда", description: "Провести 3 тренировки подряд", icon: "lunch", tone: skill },
  { id: "wolf", name: "Волк с Уолл-стрит", description: "Продать на 1 000 000 ₽", icon: "money", tone: gold },
  { id: "seller", name: "Продавашкин", description: "Продать на 100 000 ₽", icon: "coin", tone: gold },
  { id: "confident-seller", name: "Уверенный селлер", description: "Продать на 500 000 ₽", icon: "money", tone: gold },
  { id: "best-of-the-best", name: "Лучший из лучших", description: "Получить максимальную оценку 10/10", icon: "trophy", tone: gold },
  { id: "chatterbox", name: "Болтун", description: "Проиграть, потому что говорил больше пациента", icon: "chat", tone: fun },
  { id: "deaf", name: "Глухарь", description: "Не задать ни одного вопроса за тренировку", icon: "mute", tone: fun },
  { id: "door-is-there", name: "Дверь там", description: "Получить мгновенный отказ", icon: "door", tone: fun },
  { id: "youre-crazy", name: "Ты псих!", description: "Проматериться во время тренировки", icon: "angry", tone: fun },
  { id: "parrot", name: "Попка-дурак", description: "Повторить одну и ту же фразу 5 раз за тренировку", icon: "parrot", tone: fun },
  { id: "get-up", name: "Упал — вставай", description: "Продолжить тренироваться после 10 проигрышей подряд", icon: "revive", tone: fun },
  { id: "sold-a-pen", name: "Продал ручку", description: "Продать сложный продукт", icon: "pen", tone: skill },
  { id: "no-discount", name: "Неуступчивый", description: "Продать без скидки", icon: "tag", tone: skill },
  { id: "shark", name: "Акула продаж", description: "Продать 3 сложным пациентам", icon: "shark", tone: gold },
];

async function main() {
  console.log("=== Достижения ===\n");

  for (const [index, item] of ACHIEVEMENTS.entries()) {
    const data = { ...item, position: index + 1 };
    await prisma.achievement.upsert({
      where: { id: item.id },
      update: data,
      create: data,
    });
  }

  const byTone = ACHIEVEMENTS.reduce<Record<string, number>>((acc, item) => {
    acc[item.tone] = (acc[item.tone] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Всего достижений: ${ACHIEVEMENTS.length}`);
  console.log(
    `  навыки: ${byTone.skill ?? 0} · золотые: ${byTone.gold ?? 0} · шуточные: ${byTone.fun ?? 0}`
  );
  console.log("\nКто что получил — в UserAchievement, проставляется npm run seed:demo.");
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
