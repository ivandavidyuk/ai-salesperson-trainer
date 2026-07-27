// Пароль для upsert демо-аккаунтов.
//
// Правило: при создании аккаунта пароль ставим, при обновлении — нет.
// Иначе безобидный перезалив демо-данных ломает вход всем, кто сохранил
// пароль: восстановить его неоткуда, в базе только bcrypt-хэш.
//
// Сменить пароль намеренно по-прежнему можно — переменной окружения.

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export interface SeedPassword {
  /** Хэш для ветки create */
  hash: string;
  /** Поля пароля для ветки update — пустые, если менять его не просили */
  update: { passwordHash?: string };
  /**
   * Что напечатать в конце сида.
   * @param existed аккаунт был в базе до запуска
   */
  report(existed: boolean): string;
}

export async function seedPassword(envName: string): Promise<SeedPassword> {
  const explicit = process.env[envName];
  const value = explicit || randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(value, 10);

  return {
    hash,
    update: explicit ? { passwordHash: hash } : {},
    report: (existed) => {
      if (explicit) return `(из переменной окружения ${envName})`;
      return existed ? "прежний, сид его не менял" : value;
    },
  };
}
