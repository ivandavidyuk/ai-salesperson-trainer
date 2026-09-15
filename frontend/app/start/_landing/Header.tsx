"use client";

// Шапка лендинга: логотип и единственная кнопка страницы. Ссылки «Войти»
// нет намеренно: лендинг для тех, у кого доступа ещё нет.

import Logo from "@/app/components/Logo";
import { FORM_ID, scrollToSection } from "./ui";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 lg:h-[76px] lg:px-14">
        <Logo size="sm" className="lg:hidden" />
        <Logo size="md" className="hidden lg:inline-flex" />
        <button
          type="button"
          onClick={() => scrollToSection(FORM_ID)}
          className="rounded-[9px] bg-brand px-[13px] py-[9px] text-[13px] font-semibold text-white transition-colors hover:bg-brand-hover lg:rounded-[11px] lg:px-[22px] lg:py-[13px] lg:text-[16px]"
        >
          Получить демо-доступ
        </button>
      </div>
    </header>
  );
}
