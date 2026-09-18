// Cookie с отраслью организации — на сервере.
//
// Её читает корневой layout и отдаёт провайдеру слов, поэтому первая же
// отрисовка страницы идёт словами своей отрасли. Ставят её вход и /api/auth/me
// (его зовёт каждая страница через AppShell — cookie сама догоняет правку
// отрасли в профиле), снимает выход. Секрета в ней нет, но httpOnly всё равно:
// читать её браузеру незачем.

import type { NextResponse } from "next/server";
import { ключОтрасли } from "@/scripts/industry-key";
import { ОТРАСЛЬ_COOKIE, слагОтрасли } from "@/lib/industryWords";

const ГОД_СЕК = 365 * 24 * 60 * 60;

/** Слаг отрасли по ключу организации (`industryKey`): «medicine» или «realty» */
export function слагДляОрганизации(industryKey: string | null | undefined): string {
  return слагОтрасли(ключОтрасли(industryKey));
}

/** Кладёт в ответ cookie с отраслью организации */
export function поставитьОтрасль(
  response: NextResponse,
  industryKey: string | null | undefined
): void {
  response.cookies.set({
    name: ОТРАСЛЬ_COOKIE,
    value: слагДляОрганизации(industryKey),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ГОД_СЕК,
  });
}

export function снятьОтрасль(response: NextResponse): void {
  response.cookies.set({
    name: ОТРАСЛЬ_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
