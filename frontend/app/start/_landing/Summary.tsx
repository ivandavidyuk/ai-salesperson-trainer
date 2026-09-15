"use client";

// «Итого» — три утверждения, на каждое по очереди впечатывается печать-
// галочка тем же приёмом, что печать исхода сделки в разборе.

import type { ReactNode } from "react";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { useReveal } from "./hooks";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

const LINES: ReactNode[] = [
  <>
    Ошибки новичка стоят <Marker>ноль рублей</Marker> — их принимает ИИ-клиент, а не ваш
  </>,
  <>
    Каждый разговор разобран по этапам с оценкой — вы читаете вывод <Marker>за минуту</Marker>, а
    не слушаете час записи
  </>,
  <>
    „Дорого“ отрабатывается <Marker>десять раз до обеда</Marker>, а не раз в квартал на тренинге
  </>,
];

function Stamp({ delay }: { delay: number }) {
  const [ref, shown] = useReveal<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      className={`relative flex h-7 w-7 shrink-0 items-center justify-center lg:h-16 lg:w-16 ${
        shown ? "animate-stampin" : "opacity-0"
      }`}
      style={shown ? { animationDelay: `${delay}ms` } : undefined}
    >
      <span
        className={`absolute inset-0 rounded-full border-2 border-brand-muted ${shown ? "animate-shock" : "opacity-0"}`}
        style={shown ? { animationDelay: `${delay + 100}ms` } : undefined}
      />
      <span className="absolute inset-0 rounded-full bg-brand" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative h-4 w-4 lg:h-[34px] lg:w-[34px]"
        aria-hidden
      >
        <path d="M5 12.5l4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

export default function Summary() {
  return (
    <section className={`${SECTION_X} ${SCREEN} border-y border-line bg-surface-card py-11 lg:py-[110px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-9 lg:mb-16`}>
          Итого, что вы получаете
        </Reveal>
        <div className="flex max-w-[1140px] flex-col gap-7 lg:gap-11">
          {LINES.map((line, i) => (
            <Reveal key={i} delay={i * 460} className="flex items-start gap-3 lg:items-center lg:gap-7">
              <span className="mt-1 lg:mt-0">
                <Stamp delay={i * 460 + 180} />
              </span>
              <p className="min-w-0 flex-1 text-[24px] font-medium leading-[1.2] tracking-[-0.02em] text-ink [text-wrap:pretty] lg:text-[clamp(34px,3.1vw,44px)] lg:leading-[1.16] lg:tracking-[-0.025em]">
                {line}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
