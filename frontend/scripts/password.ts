// Пароли для аккаунтов, которые заводим мы: демо и клиенты на полном доступе.

import { randomBytes } from "crypto";

/**
 * Пароль, который можно продиктовать голосом: без нулей, «о», единиц и «л».
 * 10 знаков base58-алфавита — ~58 бит, для суточного доступа с запасом.
 */
export function пароль(): string {
  const алфавит = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const байты = randomBytes(10);
  return Array.from(байты, (b) => алфавит[b % алфавит.length]).join("");
}
