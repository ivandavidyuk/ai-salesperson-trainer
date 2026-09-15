"use client";

// «Что это значит для бизнеса?» — секция для владельца, только про деньги.
// Цифры — о регулярных тренировках вообще, с источниками; главная из них,
// +20%, раскладывается в рубли на следующем экране.

import type { ReactNode } from "react";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { useCountOnReveal, useInView } from "./hooks";
import { H2, INNER, MONEY_ID, SCREEN, SECTION_X, scrollToSection } from "./ui";

function Money({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-good">{children}</span>;
}

const TAKES: ReactNode[] = [
  <>
    Отдел продаж приносит <Money>больше выручки</Money> — при том же составе и той же рекламе
  </>,
  <>
    Новичка можно ставить на клиентов раньше — значит, раньше он начинает{" "}
    <Money>приносить деньги</Money>
  </>,
  <>
    Клиенты, за которых вы <Money>заплатили рекламой</Money>, чаще доходят до{" "}
    <Money>оплаты</Money> — <Money>реклама окупается</Money> лучше
  </>,
];

const SOURCE = "font-mono text-[13px] font-medium leading-[1.4] text-ink-muted";

function SourceLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${SOURCE} underline`}>
      источник
    </a>
  );
}

export default function Business() {
  const [cardRef, inView] = useInView<HTMLDivElement>();
  const main = Math.round(useCountOnReveal(20, inView));
  const wins = Math.round(useCountOnReveal(28, inView));
  const forgets = Math.round(useCountOnReveal(87, inView));

  return (
    <section className={`${SECTION_X} ${SCREEN} border-b border-line py-[52px] lg:py-[100px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} lg:max-w-[1200px]`}>
          Что это значит <Marker>для бизнеса</Marker>?
        </Reveal>
        <Reveal
          delay={40}
          className="mt-4 text-[19.5px] font-medium leading-[1.32] text-ink-muted [text-wrap:pretty] lg:mt-[22px] lg:text-[26px]"
        >
          Те же клиенты, тот же отдел — меньше сорванных сделок
        </Reveal>

        <div className="mt-9 flex flex-col gap-9 lg:mt-[60px] lg:flex-row lg:items-start lg:gap-14">
          <div className="flex min-w-0 flex-col gap-5 lg:flex-1 lg:gap-6">
            {TAKES.map((take, i) => (
              <div key={i} className="flex flex-col gap-5 lg:gap-6">
                {i > 0 && <span className="block h-px bg-line" />}
                <Reveal
                  delay={i * 130}
                  className="text-[24px] font-medium leading-[1.2] tracking-[-0.02em] text-ink [text-wrap:pretty] lg:text-[clamp(28px,2.4vw,34px)] lg:leading-[1.18]"
                >
                  {take}
                </Reveal>
              </div>
            ))}
          </div>

          <Reveal
            kind="visual"
            delay={60}
            className="rounded-[24px] border border-line bg-surface-card p-6 lg:w-[42%] lg:shrink-0 lg:p-8"
          >
            <div ref={cardRef} className="flex flex-col gap-7">
              <div>
                <div className="whitespace-nowrap text-[64px] font-semibold leading-none tracking-[-0.04em] text-good lg:text-[clamp(80px,7.2vw,104px)]">
                  +{main}%
                </div>
                <div className="mt-4 text-[17.5px] leading-[1.4] text-ink [text-wrap:pretty] lg:text-[19.5px]">
                  выручки отдела при ежедневных тренировках
                </div>
                <div className={`mt-2 ${SOURCE}`}>
                  источник: личный опыт руководителей отделов продаж
                </div>
                <button
                  type="button"
                  onClick={() => scrollToSection(MONEY_ID)}
                  className="mt-4 inline-flex items-center gap-[7px] text-[15px] font-medium text-good underline"
                >
                  сколько это в деньгах — ниже
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 4v15M5.5 12.5L12 19l6.5-6.5" />
                  </svg>
                </button>
              </div>
              <span className="block h-px bg-line" />
              <div className="flex flex-col gap-6 sm:flex-row sm:gap-7">
                <div className="min-w-0 sm:flex-1">
                  <div className="whitespace-nowrap text-[40px] font-semibold leading-none tracking-[-0.03em] text-good">
                    +{wins}%
                  </div>
                  <div className="mt-2.5 text-[17px] leading-[1.45] text-ink [text-wrap:pretty] lg:text-[17.5px]">
                    к доле выигранных сделок при регулярных тренировках
                  </div>
                  <div className="mt-2">
                    <SourceLink href="https://www.prolifiq.com/post/sales-coaching-statistics" />
                  </div>
                </div>
                <div className="min-w-0 sm:flex-1">
                  <div className="whitespace-nowrap text-[40px] font-semibold leading-none tracking-[-0.03em] text-danger">
                    {forgets}%
                  </div>
                  <div className="mt-2.5 text-[17px] leading-[1.45] text-ink [text-wrap:pretty] lg:text-[17.5px]">
                    тренинга забывается за месяц без повторения
                  </div>
                  <div className="mt-2">
                    <SourceLink href="https://www.ardentlearning.com/blog/what-is-the-forgetting-curve-in-sales-training" />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
