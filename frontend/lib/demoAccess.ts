// Демо-доступ на сутки: пара аккаунтов, выданная после демо-звонка.
//
// Часы жизни демо тикают не с выдачи, а с ПЕРВОГО разговора — выданная
// в пятницу вечером пара не сгорает к понедельнику, пока её не трогали.
// После истечения новые разговоры закрыты, но вход и разборы живут ещё
// неделю: второй созвон Димы с клиникой опирается на просмотр разборов,
// и он случается через день-два после конца суток.
//
// Потолок расхода здесь не считается — это делает обычный месячный лимит
// часов (lib/hours.ts): демо-организации он ставится в 3 часа при выдаче.

import { prisma } from "@/lib/db";

/** Сколько живёт демо после первого разговора */
const СУТКИ_МС = 24 * 60 * 60 * 1000;
/** Сколько после истечения доступны вход и разборы */
const ХВОСТ_МС = 7 * СУТКИ_МС;

export interface DemoStatus {
  organizationId: string;
  /** null — разговор ещё не начинали, сутки не тикают */
  expiresAt: Date | null;
  /** Сутки вышли: новые разговоры не начинаются */
  разговорыЗакрыты: boolean;
  /** Вышла и неделя разборов: вход закрыт целиком */
  входЗакрыт: boolean;
}

/**
 * Статус демо-доступа пользователя. null — обычный пользователь,
 * никаких демо-ограничений.
 */
export async function демоСтатус(
  userId: string,
  now: Date = new Date()
): Promise<DemoStatus | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      organization: {
        select: { id: true, isDemo: true, demoExpiresAt: true },
      },
    },
  });
  const org = user?.organization;
  if (!org?.isDemo) return null;

  const истекает = org.demoExpiresAt;
  return {
    organizationId: org.id,
    expiresAt: истекает,
    разговорыЗакрыты: истекает !== null && now.getTime() > истекает.getTime(),
    входЗакрыт:
      истекает !== null && now.getTime() > истекает.getTime() + ХВОСТ_МС,
  };
}

/**
 * Демо ли эта организация — без чтения пользователя.
 *
 * Нужна там, где решение зависит от организации, а не от того, вышли ли
 * сутки: пересборка случаев демо-клинике закрыта всегда, и в первый час
 * доступа тоже.
 */
export async function этоДемо(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isDemo: true },
  });
  return Boolean(org?.isDemo);
}

/** Текст отказа на попытку пересобрать случаи в демо — один на оба роута */
export const ГЕНЕРАЦИЯ_ЗАКРЫТА =
  "В демо-режиме клиника и пациенты уже настроены — их набор менять нельзя. " +
  "На полном доступе вы сможете описать свои услуги и диагнозы, и пациенты " +
  "пересоберутся под них.";

/**
 * Засекает первый разговор демо-организации: с этого момента сутки тикают.
 *
 * Идемпотентно и безопасно к гонке двух аккаунтов пары: условие
 * `demoExpiresAt: null` пропускает только первый вызов, второй — no-op.
 * Обычную организацию не трогает по условию `isDemo: true`.
 */
export async function засечьПервыйРазговор(
  organizationId: string,
  now: Date = new Date()
): Promise<void> {
  await prisma.organization.updateMany({
    where: { id: organizationId, isDemo: true, demoExpiresAt: null },
    data: { demoExpiresAt: new Date(now.getTime() + СУТКИ_МС) },
  });
}
