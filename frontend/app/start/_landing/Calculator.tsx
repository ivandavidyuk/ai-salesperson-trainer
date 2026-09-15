"use client";

// Калькулятор недополученной выручки. Средний чек из него читает секция
// окупаемости тарифа ниже — поэтому он в общем состоянии страницы.

import { useEffect, useState } from "react";
import Marker from "./Marker";
import NumberField from "./NumberField";
import Reveal from "./Reveal";
import { useLandingState } from "./LandingState";
import { prefersReducedMotion, useAnimatedNumber, useReveal } from "./hooks";
import { rubles } from "./numbers";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

const MIN_DEALS = 1;
const MAX_DEALS = 30;

/** Изогнутая стрелка от подсказки к полю — рисуется при появлении */
function Arrow({ drawn }: { drawn: boolean }) {
  const stroke = {
    strokeDasharray: 1,
    strokeDashoffset: drawn ? 0 : 1,
    transition: "stroke-dashoffset 500ms ease 260ms",
  };
  const head = { opacity: drawn ? 1 : 0, transition: "opacity 200ms ease 660ms" };
  return (
    <>
      <svg
        viewBox="0 0 300 130"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute left-0 top-[14px] h-[110px] w-[280px] overflow-visible text-ink-muted lg:hidden"
      >
        <path
          d="M262 8 C 300 44, 170 50, 76 86 C 56 94, 44 104, 42 116"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength={1}
          style={stroke}
        />
        <path
          d="M42 118 l -6 -12 M42 118 l 7 -11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          style={head}
        />
      </svg>
      <svg
        viewBox="0 0 300 190"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute -left-1.5 top-[27px] hidden h-[136px] w-[295px] overflow-visible text-ink-muted lg:block"
      >
        <path
          d="M215 4 C 262 44, 160 58, 86 106 C 70 118, 66 132, 66 146"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength={1}
          style={stroke}
        />
        <path
          d="M66 148 l -6 -13 M66 148 l 7 -12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          style={head}
        />
      </svg>
    </>
  );
}

const LABEL = "mb-2 block text-[13.5px] text-ink-muted lg:text-[14px]";

export default function Calculator() {
  const { check, setCheck } = useLandingState();
  const [deals, setDeals] = useState(3);
  const [areaRef, shown] = useReveal<HTMLDivElement>();
  const [highlight, setHighlight] = useState(false);

  // Поле сделок один раз подсвечивается, когда секция появилась
  useEffect(() => {
    if (!shown || prefersReducedMotion()) return;
    const on = window.setTimeout(() => setHighlight(true), 550);
    const off = window.setTimeout(() => setHighlight(false), 1550);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [shown]);

  const monthly = useAnimatedNumber(deals * check);
  const yearly = useAnimatedNumber(deals * check * 12);
  const step = (delta: number) =>
    setDeals((value) => Math.min(MAX_DEALS, Math.max(MIN_DEALS, value + delta)));

  const stepButton =
    "h-[50px] w-[46px] shrink-0 bg-surface-bubble text-[22px] font-medium text-ink transition-colors hover:bg-brand-soft disabled:text-ink-placeholder";

  return (
    <section className={`${SECTION_X} ${SCREEN} border-y border-line bg-surface-card py-11 lg:py-[110px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-[26px] lg:max-w-[1100px]`}>
          Пока менеджер учится на живых клиентах, <Marker>сделки срываются</Marker>
        </Reveal>

        <div ref={areaRef} className="relative">
          <Arrow drawn={shown} />
          <Reveal delay={30} className="mb-[112px] lg:mb-14">
            <p className="text-[17.5px] leading-[1.5] text-ink">Подставьте цифры своего отдела</p>
          </Reveal>

          <div className="flex flex-col gap-9 lg:flex-row lg:items-center lg:gap-[72px]">
            <Reveal delay={60} className="lg:w-[300px] lg:shrink-0">
              <div className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-ink-subtle">
                Например
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 lg:block">
                <div>
                  <span className={LABEL}>Сорванных сделок в месяц</span>
                  <div
                    className={`flex overflow-hidden rounded-[11px] border bg-surface-card transition-[box-shadow,border-color] duration-300 lg:inline-flex ${
                      highlight ? "border-brand ring-4 ring-brand/20" : "border-line-strong"
                    }`}
                  >
                    <button
                      type="button"
                      aria-label="Меньше сделок"
                      onClick={() => step(-1)}
                      disabled={deals <= MIN_DEALS}
                      className={`${stepButton} border-r border-line`}
                    >
                      −
                    </button>
                    <span
                      aria-live="polite"
                      className="flex min-w-[60px] flex-1 items-center justify-center font-mono text-[20px] font-medium text-ink"
                    >
                      {deals}
                    </span>
                    <button
                      type="button"
                      aria-label="Больше сделок"
                      onClick={() => step(1)}
                      disabled={deals >= MAX_DEALS}
                      className={`${stepButton} border-l border-line`}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="lg:mt-[22px]">
                  <span className={LABEL}>Средний чек</span>
                  <NumberField
                    value={check}
                    onChange={setCheck}
                    label="Средний чек, рублей"
                    className="w-full lg:w-[168px]"
                  />
                </div>
              </div>
            </Reveal>

            <Reveal kind="visual" delay={120} className="min-w-0 lg:flex-1">
              <div className="text-[clamp(40px,14vw,56px)] font-semibold leading-[0.92] tracking-[-0.045em] text-danger [overflow-wrap:anywhere] lg:whitespace-nowrap lg:text-[clamp(88px,9.7vw,140px)]">
                {rubles(monthly)}
              </div>
              <div className="mt-4 text-[22px] font-bold leading-[1.25] text-ink lg:mt-[22px] lg:text-[32px]">
                недополученной выручки в месяц
              </div>
              <div className="mt-5 text-[19.5px] leading-[1.3] text-ink-muted lg:mt-[34px] lg:text-[28px]">
                За год — <span className="whitespace-nowrap font-bold text-ink">{rubles(yearly)}</span>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
