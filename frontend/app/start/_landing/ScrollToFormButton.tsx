"use client";

// Кнопка «Получить демо-доступ» посреди страницы: ведёт к форме заявки.

import { FORM_ID, scrollToSection } from "./ui";

export default function ScrollToFormButton({ className }: { className: string }) {
  return (
    <button type="button" onClick={() => scrollToSection(FORM_ID)} className={className}>
      Получить демо-доступ
    </button>
  );
}
