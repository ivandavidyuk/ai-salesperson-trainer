// «Тарифы тренажёра» — три карточки, «Старт» выделен.

import { TARIFFS } from "@/lib/pricing";
import Reveal from "./Reveal";
import { rubles } from "./numbers";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

export default function Pricing() {
  return (
    <section className={`${SECTION_X} ${SCREEN} py-11 lg:py-[100px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-9 lg:mb-[60px]`}>
          Тарифы тренажёра
        </Reveal>
        <div className="flex flex-col gap-4 lg:flex-row lg:justify-center lg:gap-7">
          {TARIFFS.map((tariff, i) => {
            const start = i === 0;
            return (
              <Reveal
                key={tariff.name}
                kind="visual"
                delay={start ? 0 : 140}
                className={`rounded-[24px] px-7 pb-9 pt-8 lg:w-[380px] lg:shrink-0 lg:px-[38px] lg:pb-12 lg:pt-11 ${
                  start ? "bg-brand" : "border border-line bg-surface-card"
                }`}
              >
                <div className={`text-[26px] font-semibold lg:text-[32px] ${start ? "text-white" : "text-ink"}`}>
                  {tariff.name}
                </div>
                <div
                  className={`mt-5 whitespace-nowrap text-[48px] font-semibold leading-none tracking-[-0.035em] lg:mt-7 lg:text-[clamp(52px,4.6vw,66px)] ${
                    start ? "text-white" : "text-ink"
                  }`}
                >
                  {rubles(tariff.price)}
                </div>
                <div
                  className={`mt-3.5 text-[19.5px] lg:mt-[18px] lg:text-[24px] ${
                    start ? "text-brand-panel-text" : "text-ink-muted"
                  }`}
                >
                  {tariff.hours} часов разговоров в{" "}месяц
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
