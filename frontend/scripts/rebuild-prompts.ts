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

import { PrismaClient } from "@prisma/client";
import { buildRolePrompt, type PatientCase } from "./patient-prompt";
import { PROFILES } from "./patients";

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

/** Глобальные промпты: пациенты с замороженным случаем из репозитория. */
async function пересобратьГлобальные(): Promise<Итог> {
  const итог: Итог = { обновлено: 0, бездела: 0, пропущено: [] };

  for (const профиль of PROFILES) {
    if (!профиль.case) continue; // без случая роль неполна, промпта и не было
    const свежий = buildRolePrompt({ personality: профиль.personality, case: профиль.case });
    const строка = await prisma.patient.findFirst({
      where: { name: профиль.name },
      select: { id: true, prompt: true },
    });
    if (!строка) {
      итог.пропущено.push(`${профиль.name}: нет в базе`);
      continue;
    }
    if (строка.prompt === свежий) {
      итог.бездела += 1;
      continue;
    }
    await prisma.patient.update({ where: { id: строка.id }, data: { prompt: свежий } });
    итог.обновлено += 1;
  }
  return итог;
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

    const свежий = buildRolePrompt({ personality: личность, case: строка.caseData });
    if (строка.prompt === свежий) {
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
      data: { prompt: свежий },
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
  рассказать("Глобальные промпты", await пересобратьГлобальные());
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
