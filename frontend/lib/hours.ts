// Часы разговоров: сколько отдел израсходовал из месячного лимита.
//
// Тариф клиники меряется часами разговора в месяц. Пока лимита не было,
// руководитель узнавал бы о его конце в тот момент, когда у менеджеров
// перестали начинаться разговоры.
//
// Период — календарный месяц, как в макете («обновится 1 сентября»).
// Отдельной даты старта у организации нет намеренно: это лишнее состояние,
// которое пришлось бы двигать раз в месяц и чинить, когда оно отстанет.

import { prisma } from "@/lib/db";

export interface HoursUsage {
  /** Лимит по тарифу, в секундах */
  limitSec: number;
  /** Израсходовано за текущий месяц, в секундах */
  usedSec: number;
  /** Осталось, в секундах. Никогда не отрицательное */
  leftSec: number;
  /** Когда лимит обновится — первое число следующего месяца */
  resetsAt: Date;
  /** Часы кончились: новые разговоры не начинаются */
  exhausted: boolean;
}

/** Начало текущего календарного месяца по местному времени сервера. */
export function началоМесяца(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Первое число следующего месяца — когда лимит обновится. */
export function следующийМесяц(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/**
 * Расход часов организацией за текущий месяц.
 *
 * Считается по `durationSec` завершённых сессий — там уже лежит длительность
 * от старта до завершения, вместе с паузами и молчанием. Так же тарифицирует
 * нас ElevenLabs, поэтому счёт клиенту и наша себестоимость меряются одним.
 *
 * Обнуление статистики менеджера на расход НЕ влияет: часы потрачены, деньги
 * заплачены, и прятать их из тарифа значило бы дать способ обнулять счёт.
 *
 * Организация не задана — лимита нет: пользователь вне клиники (заведён
 * до организаций) не должен упереться в чужой тариф.
 */
export async function расходЧасов(
  organizationId: string | null,
  now: Date = new Date()
): Promise<HoursUsage | null> {
  if (!organizationId) return null;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { hoursLimit: true },
  });
  if (!organization) return null;

  const { _sum } = await prisma.session.aggregate({
    where: {
      status: "completed",
      startedAt: { gte: началоМесяца(now) },
      user: { organizationId },
    },
    _sum: { durationSec: true },
  });

  const limitSec = organization.hoursLimit * 3600;
  const usedSec = _sum.durationSec ?? 0;
  return {
    limitSec,
    usedSec,
    leftSec: Math.max(0, limitSec - usedSec),
    resetsAt: следующийМесяц(now),
    exhausted: usedSec >= limitSec,
  };
}

/**
 * То же по идентификатору пользователя — для проверок на входе в разговор.
 *
 * null означает «лимита нет», а не «часы кончились»: пользователь может быть
 * не привязан к клинике, и запрещать ему разговоры на этом основании было бы
 * неверно.
 */
export async function расходЧасовПользователя(
  userId: string,
  now: Date = new Date()
): Promise<HoursUsage | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });
  return расходЧасов(user?.organizationId ?? null, now);
}
