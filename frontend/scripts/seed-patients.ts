// Пациенты для мастера настройки тренировки.
// Запуск: npm run seed:patients
//
// Активна только Тамара Михайловна: backend играет её роль захардкоженным
// промптом (SYSTEM_PROMPT в backend/services/llm.py). Остальные пятеро лежат
// неактивными — в мастере они видны, но выбрать их нельзя, пока для них нет
// своего промпта. Когда появится, достаточно снять isActive: false.
//
// Скрипт идемпотентный: пациентов ищет по имени и обновляет.

import { PrismaClient, PatientDifficulty } from "@prisma/client";

const prisma = new PrismaClient();

interface PatientSeed {
  name: string;
  description: string;
  anamnesis: string;
  difficulty: PatientDifficulty;
  isActive: boolean;
}

export const PATIENTS: PatientSeed[] = [
  {
    name: "Тамара Михайловна",
    description: "62 года · диагностика зрения",
    anamnesis:
      "Очки -4 для дали, последние пять лет трудно читает вблизи. Год назад " +
      "офтальмолог поставил начальную катаракту и сказал, что операция пока не " +
      "нужна. Сомневается, не пора ли уже. За диагностику заплатила, пришла сама. " +
      "Крупные решения принимает вместе с мужем.",
    difficulty: PatientDifficulty.hard,
    isActive: true,
  },
  {
    name: "Виктор Степанович",
    description: "58 лет · глаукома",
    anamnesis:
      "Глаукома, повышенное внутриглазное давление. Периодические головные боли. " +
      "Прагматичный и деловой, ценит своё время, говорит по существу. Считает, " +
      "что капли и так держат давление, на регулярные визиты времени нет. " +
      "Решение принимает самостоятельно.",
    difficulty: PatientDifficulty.mid,
    isActive: false,
  },
  {
    name: "Анна Леонидовна",
    description: "45 лет · подбор очков",
    anamnesis:
      "Близорукость, хочет подобрать очки для работы за компьютером. Открытая " +
      "и доброжелательная, легко идёт на контакт и доверяет специалисту. " +
      "Единственное сомнение — хочет сначала сравнить цены в других клиниках. " +
      "Решает сама.",
    difficulty: PatientDifficulty.easy,
    isActive: false,
  },
  {
    name: "Галина Петровна",
    description: "67 лет · дальнозоркость",
    anamnesis:
      "Возрастная дальнозоркость, трудно читать на близком расстоянии. " +
      "Общительная, любит поговорить, легко уходит от темы в бытовые разговоры. " +
      "Считает лечение дорогим для пенсионерки и думает обойтись готовыми очками " +
      "из аптеки. Советуется с мужем перед решением.",
    difficulty: PatientDifficulty.mid,
    isActive: false,
  },
  {
    name: "Дмитрий Игоревич",
    description: "34 года · усталость глаз",
    anamnesis:
      "Сухость и усталость глаз от длительной работы за экраном. Занятой " +
      "IT-специалист, скептичен к «продажам», ценит эффективность и данные. " +
      "Считает, что само пройдёт, если меньше сидеть за экраном. Решает сам " +
      "и быстро, честность ценит выше цены.",
    difficulty: PatientDifficulty.easy,
    isActive: false,
  },
  {
    name: "Нина Аркадьевна",
    description: "71 год · ретинопатия",
    anamnesis:
      "Диабетическая ретинопатия на фоне диабета 2 типа, ухудшение зрения. " +
      "Недоверчивая и настороженная, тяжело переживает диагноз, реагирует " +
      "эмоционально. Считает, что уже ничего не поможет, а врачам лишь бы денег " +
      "содрать. Решение принимает вместе с сыном.",
    difficulty: PatientDifficulty.hard,
    isActive: false,
  },
];

async function main() {
  console.log("=== Пациенты ===\n");

  for (const item of PATIENTS) {
    // В схеме у пациента нет уникального поля — ищем по имени
    const existing = await prisma.patient.findFirst({ where: { name: item.name } });
    if (existing) {
      await prisma.patient.update({ where: { id: existing.id }, data: item });
    } else {
      await prisma.patient.create({ data: item });
    }
    const mark = item.isActive ? "доступен" : "скоро";
    console.log(`${existing ? "обновлён" : "создан "}  ${item.name} · ${mark}`);
  }

  console.log(`\nВсего пациентов: ${PATIENTS.length}`);
  console.log("Доступен для тренировки только тот, для кого есть промпт в backend.");
}

main()
  .catch((error) => {
    console.error("\nНепредвиденная ошибка:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
