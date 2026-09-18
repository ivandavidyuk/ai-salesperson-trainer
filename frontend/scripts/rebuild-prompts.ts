// Пересборка промптов из слотов — БЕЗ единого обращения к модели.
//
// Промпт роли склеен из трёх слоёв с разными владельцами: механизм и личность
// наши, случай — клиента. А в базе они лежат одной замороженной строкой,
// склеенной один раз в момент генерации.
//
// Отсюда выбор, который был у клиента до сегодня: застыть вместе с нашими
// багами или нажать «Собрать заново» и получить другого пациента. Середины
// не существовало, потому что пересборка строки и перегенерация случая были
// одной операцией.
//
// Здесь — только пересборка. Слоты случая берутся из PatientCase.caseData
// как есть, поверх ложатся сегодняшние личность и механизм. Детерминированно,
// бесплатно, можно гонять на каждом деплое — что и делается (frontend/Dockerfile).
//
// Перегенерация живёт отдельно, в rebuildCases, и зовётся только по явной
// команде руководителя.
//
//   npm run rebuild:prompts
//
// Личности клиент не правит и править не будет — они наши по замыслу.
// Поэтому источник истины для них один: репозиторий.

import { Prisma, PrismaClient } from "@prisma/client";
import { buildRolePrompt, industryRules, ключОтрасли, type PatientCase } from "./patient-prompt";
import { PROFILES } from "./patients";
import { пресетныйСлучай } from "./presets";

const prisma = new PrismaClient();

/** Слоты, без которых промпт не собрать. */
const СЛОТЫ_СЛУЧАЯ = [
  "situation",
  "calmWhile",
  "mannerExamples",
  "conditions",
  "helps",
  "vocabulary",
] as const;

/**
 * Случай без новых слотов получает их из пресета отрасли. Возвращает новый
 * объект, если что-то дописано, иначе null — так видно, надо ли сохранять.
 */
function дополнитьИзПресета(случай: PatientCase, отрасль: string, имя: string): PatientCase | null {
  if (случай.fears !== undefined && случай.moneyToday !== undefined) return null;
  const пресет = пресетныйСлучай(отрасль, имя);
  if (!пресет) return null;
  const дополнение: Partial<PatientCase> = {};
  if (случай.fears === undefined && пресет.fears !== undefined) дополнение.fears = пресет.fears;
  if (случай.moneyToday === undefined && пресет.moneyToday !== undefined) {
    дополнение.moneyToday = пресет.moneyToday;
  }
  return Object.keys(дополнение).length ? { ...случай, ...дополнение } : null;
}

function годныйСлучай(данные: unknown): данные is PatientCase {
  if (!данные || typeof данные !== "object") return false;
  const запись = данные as Record<string, unknown>;
  return СЛОТЫ_СЛУЧАЯ.every((слот) => запись[слот] !== undefined && запись[слот] !== null);
}

interface Итог {
  обновлено: number;
  бездела: number;
  пропущено: string[];
}

/** Промпты под клиники: случай клиента, личность и механизм — наши сегодняшние. */
async function пересобратьКлиентские(): Promise<Итог> {
  const итог: Итог = { обновлено: 0, бездела: 0, пропущено: [] };
  const личности = new Map(PROFILES.map((п) => [п.name, п.personality]));

  const случаи = await prisma.patientCase.findMany({
    select: {
      patientId: true,
      organizationId: true,
      prompt: true,
      caseData: true,
      patient: { select: { name: true } },
      organization: { select: { industry: true, industryKey: true } },
    },
  });

  for (const строка of случаи) {
    const имя = строка.patient.name;
    const личность = личности.get(имя);
    // Пациента убрали из репозитория, а случай остался: собрать не из чего.
    // Молча оставляем прежний промпт — разговор с ним всё ещё возможен
    if (!личность) {
      итог.пропущено.push(`${имя}: личности нет в репозитории`);
      continue;
    }
    if (!годныйСлучай(строка.caseData)) {
      итог.пропущено.push(`${имя}: слоты случая старой формы`);
      continue;
    }

    // Слоты, появившиеся после того, как случай был собран, берутся
    // из пресета той же отрасли: у клиник случаи и есть копии пресетов,
    // а ситуативные страхи и деньги с собой одинаковы для пациента
    // в пределах отрасли. Дополненный случай сохраняется, чтобы следующая
    // пересборка не искала заново
    const отрасль = строка.organization.industry;
    const дополненный = дополнитьИзПресета(строка.caseData, отрасль, имя);
    const свежий = buildRolePrompt(
      { personality: личность, case: дополненный ?? строка.caseData },
      industryRules(ключОтрасли(строка.organization.industryKey)),
    );
    if (строка.prompt === свежий && !дополненный) {
      итог.бездела += 1;
      continue;
    }
    await prisma.patientCase.update({
      where: {
        patientId_organizationId: {
          patientId: строка.patientId,
          organizationId: строка.organizationId,
        },
      },
      data: {
        prompt: свежий,
        ...(дополненный ? { caseData: дополненный as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    итог.обновлено += 1;
  }
  return итог;
}

function рассказать(что: string, итог: Итог): void {
  console.log(
    `${что}: обновлено ${итог.обновлено}, без изменений ${итог.бездела}` +
      (итог.пропущено.length ? `, пропущено ${итог.пропущено.length}` : "")
  );
  for (const строка of итог.пропущено) console.warn(`  пропущен ${строка}`);
}

async function main(): Promise<void> {
  рассказать("Промпты под клиники", await пересобратьКлиентские());
}

main()
  .catch((ошибка) => {
    // Не роняем: пересборка идёт при старте контейнера, и её сбой не должен
    // мешать приложению подняться. Промпты останутся прежними — это хуже,
    // чем свежие, но несравнимо лучше, чем лежащий сервис
    console.error("Пересборка промптов не удалась целиком:", ошибка);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
