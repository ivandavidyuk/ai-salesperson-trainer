// Пациенты для мастера настройки тренировки.
// Запуск: npm run seed:patients
//
// Сами пациенты лежат по файлу на человека в scripts/patients/ — здесь только
// заливка. Промпт собирается из слоёв (см. patient-prompt.ts) и ПЕРЕЗАПИСЫВАЕТСЯ
// при каждом запуске: источник правды — репозиторий, правки прямо в базе
// будут потеряны.
//
// Пациент без случая заливается неактивным и без промпта: случай пишет
// генератор по данным клиники, а без него в роли нет «зачем пришла».
//
// Скрипт идемпотентный: пациентов ищет по имени и обновляет.

import { PrismaClient, Prisma } from "@prisma/client";
import { buildRolePrompt, type PatientRole } from "./patient-prompt";
import { PROFILES } from "./patients";

const prisma = new PrismaClient();

// Пациенты, у которых собран случай, — по ним проверялка промптов убеждается,
// что слой механизма дошёл до каждого дословно, а случай не протёк в личность
export const LAYERED_ROLES: Record<string, PatientRole> = Object.fromEntries(
  PROFILES.filter((p) => p.case).map((p) => [
    p.name,
    { personality: p.personality, case: p.case! },
  ])
);

function toRow(profile: (typeof PROFILES)[number]): Prisma.PatientCreateInput {
  const role = profile.case
    ? { personality: profile.personality, case: profile.case }
    : null;
  return {
    name: profile.name,
    description: profile.description ?? null,
    anamnesis: profile.anamnesis ?? null,
    prompt: role ? buildRolePrompt(role) : null,
    character: profile.character,
    objections: profile.objections ?? [],
    decisionMaker: profile.decisionMaker,
    approach: profile.approach,
    // Пусто у женщин — им достаётся общий голос из настроек
    voice: profile.voice ?? null,
    difficulty: profile.difficulty,
    // Без случая роль неполна: в мастере такой пациент виден, но не выбирается
    isActive: Boolean(role),
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
    const mark = row.isActive ? "доступен" : "ждёт случая";
    const size = row.prompt ? `${row.prompt.length} символов промпта` : "без промпта";
    console.log(`${existing ? "обновлён" : "создан  "}  ${row.name} · ${mark} · ${size}`);
  }

  await removeStale(PROFILES.map((p) => p.name));

  const ready = PROFILES.filter((p) => p.case).length;
  console.log(`\nВсего пациентов: ${PROFILES.length}, со случаем: ${ready}`);
  console.log("Промпты перезаписаны значениями из репозитория.");
}

// Сид запускается только при прямом вызове: проверялка промптов импортирует
// отсюда LAYERED_ROLES, и заливать при этом базу не должна
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
