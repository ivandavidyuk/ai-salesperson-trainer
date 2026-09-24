"use client";

// Лист снизу — телефонная форма окна (макеты «Телефон · 390»): ручка,
// шапка с крестиком, прокручиваемое тело и закреплённый низ с кнопками
// во всю ширину. На компьютере окна остаются карточкой по центру: лист
// рисуется только на узком экране, этим занимается тот, кто его зовёт.

import type { ReactNode } from "react";

/** Главная кнопка листа: во всю ширину, высотой под палец */
export const SHEET_PRIMARY =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-brand px-5 text-[16px] font-semibold text-white transition-colors active:bg-brand-hover";

/** Второстепенная кнопка листа: контурная, под главной */
export const SHEET_SECONDARY =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border border-line-strong bg-surface-card px-5 text-[16px] font-semibold text-ink transition-colors active:bg-surface-bubble";

/** Кружок у заголовка: тиловый — спокойное событие, красный — запрет */
export function SheetIcon({
  tone,
  children,
}: {
  tone: "brand" | "danger";
  children: ReactNode;
}) {
  const цвет =
    tone === "brand"
      ? "bg-brand-soft text-brand"
      : "bg-danger-wash text-danger-strong";
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[19px] font-bold ${цвет}`}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

interface SheetProps {
  title: ReactNode;
  /** Кружок слева от заголовка */
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Кнопки внизу; без них низ листа — просто отступ */
  footer?: ReactNode;
  className?: string;
}

export default function Sheet({
  title,
  icon,
  onClose,
  children,
  footer,
  className = "",
}: SheetProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(12,26,24,.5)] ${className}`}
      // Касание мимо листа закрывает его — как у любого листа на телефоне
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[88dvh] flex-col rounded-t-[24px] bg-surface-card shadow-[0_-18px_50px_-24px_rgba(12,26,24,.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2" aria-hidden="true">
          <span className="h-[5px] w-9 rounded-[3px] bg-[#D5DDDB]" />
        </div>
        <div className="flex min-h-[52px] items-center gap-2 pl-5 pr-2 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icon}
            <div className="text-[19px] font-semibold leading-tight text-ink">
              {title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-muted"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-1">
          {children}
        </div>
        {footer ? (
          <div className="flex flex-col gap-2.5 border-t border-line-soft px-5 pb-5 pt-3">
            {footer}
          </div>
        ) : (
          <div className="h-3" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
