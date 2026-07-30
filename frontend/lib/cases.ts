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
import { LAYERED_ROLES } from "@/scripts/seed-patients";

interface ClinicPayload {
  name: string;
  industry: string;
  services: { name: string; price: string; description: string | null }[];
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
}

function backendUrl(): string {
  // Адрес backend известен как ws://…; http-схему выводим из него, чтобы
  // не заводить вторую переменную окружения, которая разъедется с первой
  const ws = process.env.FASTAPI_WS_URL || "ws://localhost:8000";
  return ws.replace(/^ws/, "http");
}

async function generateOne(
  personality: unknown,
  clinic: ClinicPayload,
  token: string
): Promise<GeneratedCase | null> {
  const res = await fetch(`${backendUrl()}/cases/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ personality, clinic }),
  });
  if (!res.ok) return null;
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
  headId: string
): Promise<void> {
  const names = Object.keys(LAYERED_ROLES);

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
      industry: true,
      services: {
        orderBy: { position: "asc" },
        select: { name: true, price: true, description: true },
      },
    },
  });
  if (!organization) return;

  // Пациенты, переведённые на слои. Остальные — заглушки в одно предложение,
  // из которых случай не собрать: генератору нужна личность
  const patients = await prisma.patient.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });

  await prisma.organization.update({
    where: { id: organizationId },
    data: { casesTotal: patients.length, casesReady: 0, casesUpdatedAt: new Date() },
  });

  const clinic: ClinicPayload = {
    name: organization.name,
    industry: organization.industry,
    services: organization.services,
  };
  const token = await signToken({
    userId: head.id,
    email: head.email,
    firstName: head.firstName,
    lastName: head.lastName,
  });

  let ready = 0;
  for (const patient of patients) {
    const role = LAYERED_ROLES[patient.name];
    try {
      const generated = await generateOne(role.personality, clinic, token);
      if (generated) {
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
          },
          update: {
            prompt,
            caseData: patientCase as unknown as Prisma.InputJsonValue,
            description: generated.description,
            anamnesis: generated.anamnesis,
            objections: generated.objections,
            generatedAt: new Date(),
          },
        });
        ready += 1;
      } else {
        // Пациент остаётся с прежним случаем — это лучше, чем пустой:
        // разговор с ним по-прежнему возможен, просто не по новой отрасли
        console.error(`Случай не собран: ${patient.name}`);
      }
    } catch (error) {
      console.error(`Случай не собран: ${patient.name}`, error);
    }

    await prisma.organization.update({
      where: { id: organizationId },
      data: { casesReady: ready, casesUpdatedAt: new Date() },
    });
  }
}
