// Сборка случаев пациентов под клинику.
//
// Личность пациента написана вручную и одна на все клиники. Случай — с чем
// человек пришёл именно в эту клинику — придумывает модель по отрасли
// и прайсу, которые заполнил руководитель.
//
// Разделение работы намеренное: генерирует backend (там ключ и сетевая
// позиция), а промпт из слоёв собирает эта функция существующим
// buildRolePrompt. Второй реализации сборщика на Python не появляется,
// значит нечему разъезжаться.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { buildRolePrompt, type PatientCase } from "@/scripts/patient-prompt";
import { PROFILES } from "@/scripts/patients";

interface ClinicPayload {
  name: string;
  // Город: из него пациент получает быт — транспорт, районы, расстояния.
  // Nullable в базе, потому что миграция накатывалась на живую организацию
  city: string | null;
  industry: string;
  services: { name: string; price: string; description: string | null }[];
  // Закрытый список: генератор берёт диагноз отсюда и не добавляет своего
  diagnoses: { name: string; complaint: string }[];
}

// Сколько молчания считать смертью сборки.
//
// Порог сторожит ровно один случай: рестарт контейнера посреди работы. Задача
// умирает вместе с процессом, снять флаг уже некому, и без порога лоадер
// крутился бы вечно над мёртвой сборкой.
//
// Меряется молчание ПУЛЬСА, а не готовность очередного пациента. Разница
// принципиальная: пациент с полной цепочкой правок критика занимает до девяти
// обращений к модели и легко переваливает за три минуты — по готовности живую
// сборку объявляли бы оборвавшейся, а руководитель, увидев «прервалось»,
// нажимал бы «Собрать заново» и запускал вторую сборку поверх работающей.
const STALE_AFTER_MS = 3 * 60 * 1000;

// Полминуты — шесть ударов до порога. Реже смысла нет: удар стоит одного
// UPDATE по первичному ключу, а чаще — незачем, порог и так с запасом
const ПУЛЬС_МС = 30 * 1000;

/**
 * Идёт ли сборка прямо сейчас.
 *
 * Флаг в одиночку врёт (см. STALE_AFTER_MS), поэтому живость — это флаг
 * И свежий пульс вместе. Один ответ на всех, кто спрашивает: интерфейс,
 * чтобы держать лоадер, и роуты, чтобы не запустить вторую сборку.
 */
export function сборкаЖива(состояние: {
  casesRunning: boolean;
  casesUpdatedAt: Date | null;
}): boolean {
  const пульс = состояние.casesUpdatedAt?.getTime() ?? 0;
  return состояние.casesRunning && Date.now() - пульс < STALE_AFTER_MS;
}

/** То же, когда на руках только идентификатор организации. */
export async function идётСборка(organizationId: string): Promise<boolean> {
  const состояние = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { casesRunning: true, casesUpdatedAt: true },
  });
  return состояние ? сборкаЖива(состояние) : false;
}

/** Двигает пульс, пока сборка жива. Возвращает, чем его остановить. */
function запуститьПульс(organizationId: string): () => void {
  const таймер = setInterval(() => {
    // Пропущенный удар ничего не значит: следующий придёт через полминуты,
    // а до порога их шесть. Поэтому сбой глотаем молча — падать здесь
    // означало бы уронить сборку из-за мигнувшей базы
    void prisma.organization
      .update({
        where: { id: organizationId },
        data: { casesUpdatedAt: new Date() },
      })
      .catch(() => {});
  }, ПУЛЬС_МС);
  return () => clearInterval(таймер);
}

/** Слоты случая, как их отдаёт генератор. */
interface GeneratedCase {
  situation: string;
  calmWhile: string;
  mannerExamples: string[];
  caseConditions: string[];
  caseHelps: string[];
  vocabulary: string[];
  anamnesis: string;
  description: string;
  objections: string[];
  /** Диагноз, который поставил клинический шаг. Нужен следующим пациентам:
   *  по нему сборка предпочтёт им ещё не занятую болезнь. */
  diagnosis: string;
  /** Услуга, подобранная под диагноз, — та, которую менеджер продаёт. */
  service: string;
  /** Возражение критика, если исправить не вышло. Пусто — случай чист. */
  reviewNote?: string;
}

export function backendUrl(): string {
  // Адрес backend известен как ws://…; http-схему выводим из него, чтобы
  // не заводить вторую переменную окружения, которая разъедется с первой
  const ws = process.env.FASTAPI_WS_URL || "ws://localhost:8000";
  return ws.replace(/^ws/, "http");
}

async function generateOne(
  personality: unknown,
  clinic: ClinicPayload,
  token: string,
  usedDiagnoses: string[]
): Promise<GeneratedCase | null> {
  const res = await fetch(`${backendUrl()}/cases/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ personality, clinic, usedDiagnoses }),
  });
  // Отказ разбираем вслух. Пока здесь стоял голый `if (!res.ok) return null`,
  // в логе оставалось только «Случай не собран: Имя» — по этой строке
  // неотличимы отказ модели, протухший токен и запрос, ушедший не на тот
  // сервер. Последнее и случилось 07.08: Caddy не знал про /cases/*,
  // возвращал запрос в Next.js, тот редиректил на /login, и сборка молча
  // падала на всех, пока причину не нашли раскопками по ssh
  if (!res.ok) {
    const тело = await res.text().catch(() => "");
    console.error(
      `Генератор отказал: HTTP ${res.status} ${res.url} ${тело.slice(0, 200)}`
    );
    return null;
  }
  return (await res.json()) as GeneratedCase;
}

/**
 * Пересобирает случаи всех пациентов под клинику.
 *
 * Не бросает: сбой на одном пациенте не должен ронять остальных, а сбой
 * всей сборки не должен ронять сохранение формы, которое уже произошло.
 * Прогресс пишется в организацию — по нему интерфейс держит лоадер.
 */
// Пациентов собираем по одному, а не пачкой: сто параллельных запросов
// упрутся в лимит провайдера, и половина сборки потеряется. Последовательно
// дольше, но руководитель ждёт с лоадером один раз, а не каждый разговор.
export async function rebuildCases(
  organizationId: string,
  headId: string,
  { resume = false }: { resume?: boolean } = {}
): Promise<void> {
  // Все, у кого написана личность, — им и собираем случай. Брать список
  // из тех, у кого случай уже есть, нельзя: ровно те, ради кого запускают
  // сборку, в него и не попадут
  const names = PROFILES.map((p) => p.name);

  // Токен подписываем от имени руководителя, который сохранил форму: backend
  // проверяет подпись, и анонимный вызов туда пройти не должен
  const head = await prisma.user.findUnique({
    where: { id: headId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!head) return;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      city: true,
      industry: true,
      formSavedAt: true,
      services: {
        orderBy: { position: "asc" },
        select: { name: true, price: true, description: true },
      },
      diagnoses: {
        orderBy: { position: "asc" },
        select: { name: true, complaint: true },
      },
    },
  });
  if (!organization) return;

  // Только те, кто есть в репозитории. Пациент, оставшийся в базе от прежних
  // версий, личности не имеет — собирать ему случай не из чего
  const all = await prisma.patient.findMany({
    where: { name: { in: names } },
    select: {
      id: true,
      name: true,
      cases: {
        where: { organizationId },
        select: { generatedAt: true },
      },
    },
  });

  // «Собрать заново» после обрыва продолжает с места, а не идёт по кругу:
  // случай, собранный позже последнего сохранения формы, уже отвечает текущим
  // данным клиники. На сотне пациентов это вдвое меньше вызовов модели,
  // а отказы провайдера — обычное дело.
  const savedAt = organization.formSavedAt;
  const isFresh = (patient: (typeof all)[number]) =>
    Boolean(savedAt && patient.cases[0] && patient.cases[0].generatedAt >= savedAt);

  const patients = resume ? all.filter((p) => !isFresh(p)) : all;
  const alreadyDone = resume ? all.length - patients.length : 0;

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      casesTotal: all.length,
      casesReady: alreadyDone,
      casesUpdatedAt: new Date(),
    },
  });

  const clinic: ClinicPayload = {
    name: organization.name,
    city: organization.city,
    industry: organization.industry,
    services: organization.services,
    diagnoses: organization.diagnoses,
  };
  const token = await signToken({
    userId: head.id,
    email: head.email,
    firstName: head.firstName,
    lastName: head.lastName,
  });

  let ready = alreadyDone;
  const остановитьПульс = запуститьПульс(organizationId);
  try {
    ready = await generateAll(patients, organizationId, clinic, token, ready);
  } finally {
    // Гасим ДО снятия флага: живой таймер после этого двигал бы пульс
    // у сборки, которой уже нет
    остановитьПульс();
    // Флаг снимаем в любом исходе. Оставить его поднятым после падения —
    // это вечный лоадер у руководителя: страница будет считать, что сборка
    // всё ещё идёт, и никогда не покажет, что часть пациентов не собралась
    await prisma.organization.update({
      where: { id: organizationId },
      data: { casesRunning: false, casesUpdatedAt: new Date() },
    });
  }
}

/** Собирает случаи по одному, возвращает, сколько получилось. */
async function generateAll(
  patients: { id: string; name: string }[],
  organizationId: string,
  clinic: ClinicPayload,
  token: string,
  alreadyDone: number
): Promise<number> {
  const byName = new Map(PROFILES.map((p) => [p.name, p]));
  // Занятые болезни копим по ходу сборки: сборка идёт последовательно,
  // и каждый следующий пациент знает, что уже выпало предыдущим. Это мягкое
  // предпочтение, а не запрет — правдоподобие важнее разнообразия.
  //
  // При «собрать заново» после обрыва список начинается пустым: диагнозы
  // готовых случаев в базе не лежат. Разнообразие от этого чуть слабее,
  // но ни один случай не становится неверным.
  const usedDiagnoses: string[] = [];
  // Кого критик забраковал, а исправить не вышло. Пометка лежит в базе
  // полем reviewNote; здесь — чтобы итог сборки был виден сразу, не дожидаясь
  // запроса. Случай при этом сохраняется: пациент без случая хуже помеченного
  const помеченные: string[] = [];
  let ready = alreadyDone;

  /** Одна попытка на пациента. true — случай сохранён. */
  const собрать = async (patient: { id: string; name: string }): Promise<boolean> => {
    const role = byName.get(patient.name)!;
    try {
      const generated = await generateOne(role.personality, clinic, token, usedDiagnoses);
      if (!generated) {
        // Пациент остаётся с прежним случаем — это лучше, чем пустой:
        // разговор с ним по-прежнему возможен, просто не по новой отрасли
        console.error(`Случай не собран: ${patient.name}`);
        return false;
      }
      if (generated.diagnosis) usedDiagnoses.push(generated.diagnosis);
      const patientCase: PatientCase = {
        situation: generated.situation,
        calmWhile: generated.calmWhile,
        mannerExamples: generated.mannerExamples.join("\n"),
        conditions: generated.caseConditions,
        helps: generated.caseHelps,
        vocabulary: generated.vocabulary,
      };
      const prompt = buildRolePrompt({ personality: role.personality, case: patientCase });

      await prisma.patientCase.upsert({
        where: {
          patientId_organizationId: { patientId: patient.id, organizationId },
        },
        create: {
          patientId: patient.id,
          organizationId,
          prompt,
          caseData: patientCase as unknown as Prisma.InputJsonValue,
          description: generated.description,
          anamnesis: generated.anamnesis,
          objections: generated.objections,
          reviewNote: generated.reviewNote || null,
        },
        update: {
          prompt,
          caseData: patientCase as unknown as Prisma.InputJsonValue,
          description: generated.description,
          anamnesis: generated.anamnesis,
          objections: generated.objections,
          // Пустая строка, а не пропуск: пересборка должна СНИМАТЬ старую
          // пометку, если на этот раз случай прошёл критика чисто
          reviewNote: generated.reviewNote || null,
          // Документ диагностики обнуляем по той же причине, но она весомее.
          // Поле, не перечисленное в update, переживает upsert — вычитанный
          // врачом документ остался бы висеть на СВЕЖЕМ анамнезе и описывал
          // бы чужую болезнь, оставаясь правдоподобным. Это худший вид
          // поломки: менеджер документу верит, а пациент говорит о другом.
          // Пусто — включится генератор и напишет по новому случаю
          diagnosticsPreset: null,
          generatedAt: new Date(),
        },
      });
      ready += 1;
      if (generated.reviewNote) помеченные.push(patient.name);
      return true;
    } catch (error) {
      console.error(`Случай не собран: ${patient.name}`, error);
      return false;
    }
  };

  const отметить = () =>
    prisma.organization.update({
      where: { id: organizationId },
      data: { casesReady: ready, casesUpdatedAt: new Date() },
    });

  const упавшие: typeof patients = [];
  for (const patient of patients) {
    if (!(await собрать(patient))) упавшие.push(patient);
    await отметить();
  }

  // Второй проход по упавшим — и только по ним. Пересобирать всё значило бы
  // заново платить за два десятка удачных ради одного неудачного.
  //
  // ИМЕННО В КОНЦЕ, а не сразу после сбоя. Если провайдер поймал плохую
  // минуту, немедленный повтор попадёт в ту же минуту; между проходами
  // пройдёт десять-двадцать, и это лечит случайный сбой. Побочная польза:
  // к концу список занятых диагнозов полон, и пересобранным достанется
  // более разнообразная картина.
  //
  // Проход ровно один. Внутри конвейера уже по две-три попытки на каждом
  // шаге; если и после этого не вышло, дело не в случайности, а в самом
  // пациенте или в узости прайса — по кругу тут только деньги терять.
  if (упавшие.length) {
    console.warn(
      `Пересборка упавших (${упавшие.length}): ${упавшие.map((p) => p.name).join(", ")}`
    );
    for (const patient of упавшие) {
      const вышло = await собрать(patient);
      console.warn(`Пересборка ${patient.name}: ${вышло ? "получилось" : "снова мимо"}`);
      await отметить();
    }
  }

  // Помеченные — не сбой сборки, а повод прочитать их до запуска клиники:
  // критик нашёл беду и не смог её выправить, случай сохранён как есть
  if (помеченные.length) {
    console.warn(
      `Случаев с пометкой критика (${помеченные.length}): ${помеченные.join(", ")}. ` +
        `Читать через PatientCase.reviewNote`
    );
  }
  return ready;
}
