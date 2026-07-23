// Проверка роли для роутов, доступных только руководителю.
//
// Роль читаем из базы, а не из JWT: токен живёт сутки, и смена роли
// не подействовала бы до перелогина. Запрос дешёвый, а гарантия честная.

import type { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export interface AccessUser {
  id: string;
  role: UserRole;
}

/** Текущий пользователь вместе с ролью, либо null если не авторизован. */
export async function getUserWithRole(
  request: NextRequest
): Promise<AccessUser | null> {
  const auth = await getAuthUser(request);
  if (!auth) return null;

  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { id: true, role: true },
  });
  return user ?? null;
}

/** Пользователь, если он руководитель. Иначе null — вызывающий отдаёт 403. */
export async function requireHead(
  request: NextRequest
): Promise<AccessUser | null> {
  const user = await getUserWithRole(request);
  if (!user || user.role !== UserRole.head) return null;
  return user;
}
