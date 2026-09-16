// Пациенты для мастера настройки тренировки.
// Запуск: npm run seed:patients
//
// Сами пациенты лежат по файлу на человека в scripts/patients/ — здесь только
// заливка личности, досье, голоса и сложности. Значения ПЕРЕЗАПИСЫВАЮТСЯ
// при каждом запуске: источник правды — репозиторий, правки прямо в базе
// будут потеряны.
//
// Промпта роли в Patient нет: он собирается под организацию из личности
// и её случая (seed:presets, rebuild:prompts) и лежит в PatientCase.prompt.
// До 16.09 сюда писался «глобальный» офтальмологический промпт как запасной;
// на проде им никто не пользовался, и его убрали вместе со случаями
// из файлов личностей.
//
// Скрипт идемпотентный: пациентов ищет по имени и обновляет.

import { PrismaClient, Prisma } from "@prisma/client";
import { PROFILES } from "./patients";

const prisma = new PrismaClient();

function toRow(profile: (typeof PROFILES)[number]): Prisma.PatientCreateInput {
  return {
    name: profile.name,
    // Видимые отраслевые поля и промпт живут в случае организации.
    // В Patient их обнуляем явно, чтобы прежние значения не пережили сид
    description: null,
    anamnesis: null,
    prompt: null,
    objections: [],
    character: profile.character,
    decisionMaker: profile.decisionMaker,
    approach: profile.approach,
    // Пусто у женщин — им достаётся общий голос из настроек
    voice: profile.voice ?? null,
    difficulty: profile.difficulty,
    // Активны все: есть ли у организации случай этого пациента, проверяется
    // на старте разговора, а не флагом
    isActive: true,
  };
}

/**
 * Убирает из базы пациентов, которых больше нет в репозитории.
 *
 * Пациента с разговорами НЕ УДАЛЯЕТ: за ним стоят расшифровки, оценки
 * и статистика отдела, и сид не вправе сносить историю ради порядка в списке.
 * Такого он гасит и говорит, сколько разговоров мешает, — дальше решает человек.
 */
async function removeStale(keep: string[]): Promise<void> {
  const stale = await prisma.patient.findMany({
    where: { name: { notIn: keep } },
    select: { id: true, name: true, _count: { select: { sessions: true } } },
  });
  if (stale.length === 0) return;

  console.log("\n=== Лишние пациенты ===\n");
  for (const patient of stale) {
    if (patient._count.sessions > 0) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: { isActive: false },
      });
      console.log(
        `скрыт     ${patient.name} — не удаляю, за ним ${patient._count.sessions} разговоров`
      );
      continue;
    }
    await prisma.patient.delete({ where: { id: patient.id } });
    console.log(`удалён    ${patient.name}`);
  }
}

async function main() {
  console.log("=== Пациенты ===\n");

  for (const profile of PROFILES) {
    const row = toRow(profile);
    // В схеме у пациента нет уникального поля — ищем по имени
    const existing = await prisma.patient.findFirst({ where: { name: row.name } });
    if (existing) {
      await prisma.patient.update({ where: { id: existing.id }, data: row });
    } else {
      await prisma.patient.create({ data: row });
    }
    console.log(`${existing ? "обновлён" : "создан  "}  ${row.name}`);
  }

  await removeStale(PROFILES.map((p) => p.name));

  console.log(`\nВсего пациентов: ${PROFILES.length}.`);
  console.log("Личности и досье перезаписаны значениями из репозитория; случаи — в пресетах.");
}

// Сид запускается только при прямом вызове, чтобы импорт из проверок
// не заливал базу
if (require.main === module) {
  main()
    .catch((error) => {
      console.error("\nНепредвиденная ошибка:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
