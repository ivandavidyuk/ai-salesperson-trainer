// Задания: разбор входных полей, общий для создания и правки.
//
// Создание требует все поля разом, правка — только присланные. Проверки
// при этом одни и те же, и держать их в двух роутах значит однажды
// разойтись: в одном месте запретить неактивного пациента, в другом забыть.

import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Сколько дней держим выполненные задания в списке */
export const ОКНО_ВЫПОЛНЕННЫХ_ДНЕЙ = 30;

export function началоОкнаВыполненных(now: Date = new Date()): Date {
  const с = new Date(now);
  с.setDate(с.getDate() - ОКНО_ВЫПОЛНЕННЫХ_ДНЕЙ);
  return с;
}

export interface ПоляЗадания {
  userId?: string;
  patientId?: string;
  trainingTypeId?: string;
  title?: string;
  comment?: string;
  dueAt?: string | null;
  isPriority?: boolean;
}

/** Что пойдёт в базу: только те поля, которые прислали и которые прошли */
export interface РазобранныеПоля {
  userId?: string;
  patientId?: string;
  trainingTypeId?: string;
  title?: string;
  comment?: string;
  dueAt?: Date | null;
  isPriority?: boolean;
}

type Итог =
  | { ok: true; поля: РазобранныеПоля }
  | { ok: false; ошибка: string };

/**
 * Проверяет поля задания.
 *
 * `всеОбязательны` — режим создания: нет адресата, пациента, типа или
 * названия, значит запрос неполный. В режиме правки отсутствующее поле
 * просто не меняется, а присланное проверяется так же строго.
 *
 * `организация` — отдел руководителя. Адресат сверяется с ней: до 11.09
 * проверялась только роль, и руководитель мог выставить задание менеджеру
 * чужой клиники — тот увидел бы у себя задание за подписью незнакомого
 * человека. Интерфейс такого не предлагал, но запрос можно послать мимо него.
 */
export async function разобратьЗадание(
  body: ПоляЗадания,
  {
    всеОбязательны,
    организация,
  }: { всеОбязательны: boolean; организация: string | null }
): Promise<Итог> {
  const поля: РазобранныеПоля = {};

  if (body.title !== undefined || всеОбязательны) {
    const title = body.title?.trim() ?? "";
    if (!title) return { ok: false, ошибка: "Укажите название задания" };
    поля.title = title;
  }

  if (body.comment !== undefined || всеОбязательны) {
    поля.comment = body.comment?.trim() ?? "";
  }

  if (body.userId !== undefined || всеОбязательны) {
    // Назначать можно только менеджеру: задание другому руководителю
    // сломало бы смысл раздела
    const target =
      body.userId && организация
        ? await prisma.user.findFirst({
            where: {
              id: body.userId,
              role: UserRole.manager,
              organizationId: организация,
            },
            select: { id: true },
          })
        : null;
    if (!target) {
      return { ok: false, ошибка: "Выберите менеджера своего отдела" };
    }
    поля.userId = target.id;
  }

  if (body.patientId !== undefined || всеОбязательны) {
    const patient = body.patientId
      ? await prisma.patient.findUnique({
          where: { id: body.patientId },
          select: { id: true, isActive: true },
        })
      : null;
    if (!patient?.isActive) {
      return { ok: false, ошибка: "Этот пациент пока недоступен" };
    }
    поля.patientId = patient.id;
  }

  if (body.trainingTypeId !== undefined || всеОбязательны) {
    const type = body.trainingTypeId
      ? await prisma.trainingType.findUnique({
          where: { id: body.trainingTypeId },
          select: { id: true, isActive: true },
        })
      : null;
    if (!type?.isActive) {
      return { ok: false, ошибка: "Этот тип тренировки пока недоступен" };
    }
    поля.trainingTypeId = type.id;
  }

  if (body.dueAt !== undefined || всеОбязательны) {
    // Срок хранится концом дня: «до 24 июля» значит весь день 24-го
    let dueAt: Date | null = null;
    if (body.dueAt) {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, ошибка: "Некорректный срок" };
      }
      parsed.setHours(23, 59, 59, 0);
      dueAt = parsed;
    }
    поля.dueAt = dueAt;
  }

  if (body.isPriority !== undefined || всеОбязательны) {
    поля.isPriority = Boolean(body.isPriority);
  }

  return { ok: true, поля };
}
