"use client";

// Карточка «Первый раз здесь?» на главной: новичку сообщает, что есть
// шпаргалка по тренажёру. Видна, пока у человека нет ни одного разговора
// и он шпаргалку не открыл и карточку не закрыл. Значок в рейке Иван
// справедливо назвал местом, куда не посмотрит ни один человек, — новичку
// о шпаргалке говорим прямо на первом экране.

import Link from "next/link";
import { useState } from "react";
import { отметитьШпаргалку } from "@/app/components/AppShell";
import { Пиктограмма, пиктограммы } from "@/app/components/HintTile";
import { useIndustry } from "@/app/components/IndustryProvider";

export default function HelpNotice({ className = "" }: { className?: string }) {
  const [скрыта, setСкрыта] = useState(false);
  // Столько шагов в справке: у недвижимости нет шага о диагностике
  const шагов = useIndustry() === "медицина" ? 6 : 5;
  if (скрыта) return null;

  return (
    <div
      className={`relative flex items-center gap-4 rounded-card border border-line-accent bg-surface-accent py-4 pl-5 pr-14 max-md:flex-col max-md:items-stretch max-md:gap-3.5 max-md:rounded-2xl max-md:p-4 max-md:pr-4 ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5 max-md:pr-9">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Пиктограмма>{пиктограммы.справка}</Пиктограмма>
        </span>
        <div className="min-w-0">
          <div className="text-[17px] font-semibold text-ink">Первый раз здесь?</div>
          <div className="mt-0.5 text-[15px] text-ink-muted">
            Шпаргалка: {шагов} шагов на картинках
          </div>
        </div>
      </div>
      <Link
        href="/help"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-input bg-brand px-5 text-[15.5px] font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        Открыть шпаргалку
      </Link>
      <button
        type="button"
        onClick={() => {
          setСкрыта(true);
          отметитьШпаргалку();
        }}
        aria-label="Скрыть"
        title="Скрыть"
        className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-icon transition-colors hover:bg-surface-bubble hover:text-ink-muted max-md:right-1.5 max-md:top-1.5"
      >
        <svg
          width="18"
          height="18"
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
  );
}
