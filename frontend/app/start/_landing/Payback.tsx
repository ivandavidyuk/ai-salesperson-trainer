"use client";

// «Сколько спасённых тренажёром сделок окупают тариф» — стоит после тарифов,
// чтобы цена звучала, когда уже понятно, за что её просят. Средний чек
// берётся из калькулятора выше; тариф выбирается для расчёта, не для покупки.

import { useState } from "react";
import { plural } from "@/lib/format";
import { TARIFFS } from "@/lib/pricing";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { useLandingState } from "./LandingState";
import { useAnimatedNumber, useReveal } from "./hooks";
import { numberWord, rubles } from "./numbers";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

export default function Payback() {
  const { check } = useLandingState();
  const [selected, setSelected] = useState(0);
  const [barsRef, barsShown] = useReveal<HTMLDivElement>();

  const tariff = TARIFFS[selected];
  const deals = check > 0 ? Math.ceil(tariff.price / check) : 0;
  const shownDeals = Math.round(useAnimatedNumber(deals, 500));
  const max = Math.max(check, tariff.price) || 1;
  const bar = (value: number) => (barsShown ? `${(value / max) * 100}%` : "0%");

  const line =
    check > 0
      ? `При среднем чеке ${rubles(check)} ${numberWord(deals)} ${plural(
          deals,
          "сделка, спасённая",
          "сделки, спасённые",
          "сделок, спасённых",
        )} благодаря тренажёру, ${plural(deals, "окупает", "окупают", "окупают")} тариф «${
          tariff.name
        }» целиком`
      : "Укажите средний чек в калькуляторе выше — посчитаем окупаемость";

  return (
    <section className={`${SECTION_X} ${SCREEN} py-11 lg:py-[110px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-5 lg:mb-[26px] lg:max-w-[1100px]`}>
          Сколько <Marker>спасённых тренажёром</Marker> сделок окупают тариф
        </Reveal>
        <Reveal
          as="p"
          delay={20}
          className="mb-6 text-[17.5px] leading-[1.5] text-ink-muted [text-wrap:pretty] lg:mb-[30px] lg:max-w-[900px]"
        >
          Прикиньте, какой тариф вам ближе, — посчитаем окупаемость для него
        </Reveal>
        <Reveal delay={40} className="grid grid-cols-3 gap-2.5 lg:flex">
          {TARIFFS.map((item, i) => {
            const on = i === selected;
            return (
              <button
                key={item.name}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(i)}
                className={`rounded-[11px] border-[length:1.5px] px-3 py-[13px] text-[17px] transition-colors lg:px-[26px] ${
                  on
                    ? "border-brand bg-brand font-semibold text-white"
                    : "border-line-strong bg-surface-card font-medium text-ink hover:border-brand"
                }`}
              >
                {item.name}
              </button>
            );
          })}
        </Reveal>

        <div className="mt-9 flex flex-col gap-9 lg:mt-12 lg:flex-row lg:items-end lg:gap-20">
          <Reveal delay={60} className="min-w-0 lg:flex-1">
            <div className="whitespace-nowrap text-[clamp(44px,15vw,64px)] font-semibold leading-[0.92] tracking-[-0.045em] text-brand lg:text-[clamp(88px,9.7vw,140px)]">
              {check > 0 ? `${shownDeals} ${plural(shownDeals, "сделка", "сделки", "сделок")}` : "—"}
            </div>
            <p className="mt-5 max-w-[640px] text-[17.5px] leading-[1.45] text-ink-muted [text-wrap:pretty] lg:mt-[26px] lg:text-[22px]">
              {line}
            </p>
          </Reveal>

          <Reveal delay={120} className="shrink-0">
            <div ref={barsRef} className="flex justify-center gap-6 lg:gap-8">
              {[
                { value: check, label: "сделка, спасённая тренажёром", tone: "bg-brand" },
                { value: tariff.price, label: `тариф «${tariff.name}»`, tone: "bg-line-strong" },
              ].map((item) => (
                <div key={item.tone} className="w-[42%] max-w-[180px] lg:w-[180px]">
                  <div className="flex h-[180px] items-end lg:h-[260px]">
                    <div
                      className={`w-full rounded-t-lg transition-[height] duration-[600ms] ease-[cubic-bezier(.2,.8,.3,1)] motion-reduce:transition-none ${item.tone}`}
                      style={{ height: bar(item.value) }}
                    />
                  </div>
                  <div className="mt-3.5 text-[14.5px] leading-[1.35] text-ink-muted lg:text-[16px]">
                    {item.label}
                  </div>
                  <div className="mt-1 whitespace-nowrap font-mono text-[17px] font-medium text-ink lg:text-[19px]">
                    {rubles(item.value)}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
