"use client";

// «+20% — это сколько в деньгах?» — выручка на 12 месяцев без тренировок
// и с ними. Вторая линия — та же первая, поднятая на пятую часть в каждом
// месяце, без нарастающего итога. Помесячные колебания условны; множители
// в сумме дают ровно 12, поэтому среднее за год равно значению поля.

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Marker from "./Marker";
import NumberField from "./NumberField";
import Reveal from "./Reveal";
import { useInView, usePrefersReducedMotion } from "./hooks";
import { millions, rubles } from "./numbers";
import { H2, INNER, MONEY_ID, SECTION_X } from "./ui";

const MULTIPLIERS = [0.95, 0.97, 1.03, 1.0, 0.97, 0.93, 0.92, 0.97, 1.03, 1.06, 1.07, 1.1];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const GROWTH = 1.2;
const DEFAULT_REVENUE = 15_000_000;

/** Круглый шаг сетки: 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × степень десяти */
function niceStep(value: number): number {
  if (!(value > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  for (const candidate of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= candidate * power + 1e-9) return candidate * power;
  }
  return 10 * power;
}

function Chart({ revenue, drawn }: { revenue: number; drawn: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(-1);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setWidth(box.clientWidth));
    observer.observe(box);
    setWidth(box.clientWidth);
    return () => observer.disconnect();
  }, []);

  const phone = width > 0 && width < 560;
  const height = phone ? 240 : 340;
  const padLeft = phone ? 54 : 80;
  const padRight = phone ? 12 : 20;
  const padTop = phone ? 18 : 24;
  const padBottom = phone ? 28 : 32;
  const fontSize = phone ? 10 : 12;

  const base = MULTIPLIERS.map((m) => revenue * m);
  const trained = base.map((value) => value * GROWTH);
  const step = niceStep(Math.max(...trained) / 3);
  const top = step * 3;
  const x = (i: number) => padLeft + (i * (width - padLeft - padRight)) / 11;
  const y = (value: number) => height - padBottom - (value / top) * (height - padTop - padBottom);
  const line = (values: number[]) =>
    values.map((value, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line(base)} ${trained
    .map((_, k) => {
      const i = 11 - k;
      return `L${x(i).toFixed(1)},${y(trained[i]).toFixed(1)}`;
    })
    .join(" ")} Z`;

  const draw = (delay: number) => ({
    strokeDasharray: 1,
    strokeDashoffset: drawn ? 0 : 1,
    transition: reduced ? "none" : `stroke-dashoffset 950ms cubic-bezier(.3,.7,.3,1) ${delay}ms`,
  });

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const stepX = (width - padLeft - padRight) / 11;
    setHover(Math.max(0, Math.min(11, Math.round((px - padLeft) / stepX))));
  };

  return (
    <div
      ref={boxRef}
      className="relative w-full touch-pan-y"
      style={{ height }}
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(-1)}
    >
      {width > 0 && revenue > 0 && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          {[0, 1, 2, 3].map((k) => {
            const gy = y(step * k);
            return (
              <g key={k}>
                <line x1={padLeft} y1={gy} x2={width - padRight} y2={gy} className="stroke-line" strokeWidth={1} />
                <text
                  x={padLeft - 10}
                  y={gy + 4}
                  textAnchor="end"
                  fontSize={fontSize}
                  className="fill-ink-muted font-mono"
                >
                  {k ? millions(step * k) : "0"}
                </text>
              </g>
            );
          })}
          {MONTHS_SHORT.map((month, i) =>
            phone && i % 2 === 1 ? null : (
              <text
                key={month}
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={fontSize}
                className="fill-ink-muted"
              >
                {month}
              </text>
            ),
          )}
          <path
            d={area}
            className="fill-good"
            style={{
              fillOpacity: drawn ? 0.12 : 0,
              transition: reduced ? "none" : "fill-opacity 700ms ease 760ms",
            }}
          />
          <path
            d={line(base)}
            fill="none"
            className="stroke-line-strong"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            style={draw(0)}
          />
          <path
            d={line(trained)}
            fill="none"
            className="stroke-good"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            style={draw(160)}
          />
          {hover >= 0 && (
            <>
              <line
                x1={x(hover)}
                y1={padTop - 12}
                x2={x(hover)}
                y2={height - padBottom}
                className="stroke-ink-subtle"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <circle cx={x(hover)} cy={y(base[hover])} r={4} className="fill-white stroke-ink-subtle" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(trained[hover])} r={5} className="fill-white stroke-good" strokeWidth={3} />
            </>
          )}
        </svg>
      )}
      {hover >= 0 && width > 0 && (
        <div
          className="pointer-events-none absolute whitespace-nowrap rounded-[11px] bg-ink px-[13px] py-2.5 text-[11.5px] leading-[1.5] text-white shadow-[0_14px_30px_-16px_rgba(8,20,18,0.8)] lg:text-[13px]"
          style={{
            left: Math.max(76, Math.min(width - 76, x(hover))),
            top: y(trained[hover]) - 16,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="mb-1 font-semibold">{MONTHS[hover]}</div>
          <div className="text-disabled">без тренировок — {millions(base[hover])}</div>
          <div className="font-semibold text-good-surface">с тренировками — {millions(trained[hover])}</div>
          <div className="text-disabled">разница +{millions(trained[hover] - base[hover])}</div>
        </div>
      )}
    </div>
  );
}

export default function RevenueChart() {
  const [revenue, setRevenue] = useState(DEFAULT_REVENUE);
  const [chartRef, inView] = useInView<HTMLDivElement>();

  return (
    <section
      id={MONEY_ID}
      className={`${SECTION_X} scroll-mt-14 border-b border-line bg-surface-card py-[52px] lg:flex lg:min-h-[100svh] lg:scroll-mt-[76px] lg:flex-col lg:justify-center lg:py-[100px]`}
    >
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} lg:max-w-[1200px]`}>
          +20% — это сколько <Marker>в деньгах</Marker>?
        </Reveal>

        <Reveal delay={40} className="mt-7 lg:mt-[34px]">
          <span className="mb-2 block text-[13.5px] text-ink-muted lg:text-[14px]">
            Средняя выручка отдела в месяц, ₽*
          </span>
          <NumberField
            value={DEFAULT_REVENUE}
            onChange={setRevenue}
            label="Средняя выручка отдела в месяц, рублей"
            tone="good"
            maxDigits={11}
            className="w-full sm:w-[240px]"
          />
          <p className="mt-2.5 max-w-[420px] font-mono text-[12.5px] font-medium leading-[1.45] text-ink-muted lg:text-[13px]">
            * средняя выручка в месяц на примере стоматологической клиники по данным{" "}
            <a
              href="https://kontur.ru/lp/segmentplus/blog/80921-zarabatyvayut_stomatologii"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              источника
            </a>
          </p>
        </Reveal>

        <div className="mt-9 flex flex-col gap-8 lg:mt-11 lg:flex-row lg:items-start lg:gap-16">
          <Reveal kind="visual" delay={80} className="min-w-0 lg:flex-1">
            <div ref={chartRef}>
              <Chart revenue={revenue} drawn={inView} />
            </div>
            <div className="mt-5 flex flex-col gap-[9px] text-[14px] leading-[1.35] text-ink-muted lg:mt-[22px] lg:text-[15px]">
              <span className="flex items-center gap-2.5">
                <span className="h-0.5 w-[22px] shrink-0 rounded-sm bg-line-strong" />
                без тренировок — в среднем {rubles(revenue)} в месяц
              </span>
              <span className="flex items-center gap-2.5 text-ink">
                <span className="h-1 w-[22px] shrink-0 rounded-sm bg-good" />
                с регулярными тренировками — в среднем {rubles(revenue * GROWTH)} в месяц
              </span>
            </div>
          </Reveal>

          <Reveal kind="visual" delay={120} className="flex flex-col gap-4 lg:w-[360px] lg:shrink-0 lg:gap-[18px] lg:pt-2">
            <div className="text-[19.5px] leading-[1.3] text-ink-muted [text-wrap:pretty] lg:text-[22px]">
              {rubles(revenue * 12)} за год без тренировок
            </div>
            <div className="text-[19.5px] leading-[1.3] text-ink [text-wrap:pretty] lg:text-[22px]">
              {rubles(revenue * 12 * GROWTH)} за год с тренировками
            </div>
            <div className="text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-good [text-wrap:pretty] lg:text-[44px]">
              +{rubles(revenue * 12 * (GROWTH - 1))} за{" "}год
            </div>
          </Reveal>
        </div>

        <Reveal
          delay={140}
          className="mt-8 text-[12.5px] leading-[1.45] text-ink-muted [text-wrap:pretty] lg:mt-[34px] lg:text-[13px]"
        >
          Пример расчёта: +20% к выручке каждого месяца — по опыту руководителей отделов продаж;
          помесячные колебания условны
        </Reveal>
      </div>
    </section>
  );
}
