// «Как учат сейчас — и чем за это платят»: было и стало двумя карточками.

import Marker from "./Marker";
import Reveal from "./Reveal";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

const NOW: [string, string][] = [
  ["Ролевые игры с руководителем", "час руководителя каждый день"],
  ["Прослушивание записей", "клиент, который уже ушёл"],
  ["Сразу на живых клиентах", "ваши деньги"],
];

const WITH_TRAINER = [
  "Разговор с ИИ-клиентом — когда угодно, без руководителя",
  "Разбор по фразам сразу после разговора",
  "Ошибка стоит ноль: клиент ненастоящий",
];

function Cross() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      className="mt-[5px] shrink-0 text-danger"
      aria-hidden
    >
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-[5px] shrink-0 text-brand"
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

const CARD =
  "rounded-[20px] bg-surface-card px-6 pb-8 pt-7 lg:w-[480px] lg:shrink-0 lg:px-[34px] lg:pb-9 lg:pt-8";
const CAPTION = "font-mono text-[12px] font-medium uppercase tracking-[0.16em] lg:text-[13px]";
const ITEM = "text-[19.5px] font-medium leading-[1.3] text-ink [text-wrap:pretty] lg:text-[22px]";

export default function NowVsTrainer() {
  return (
    <section className={`${SECTION_X} ${SCREEN} py-11 lg:py-[110px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} lg:max-w-[1000px]`}>
          Как учат сейчас — и <Marker>чем за это платят</Marker>
        </Reveal>
        <Reveal
          as="p"
          delay={60}
          className="mt-4 text-[17.5px] leading-[1.5] text-ink-muted [text-wrap:pretty] lg:mt-5 lg:max-w-[820px] lg:text-[19.5px]"
        >
          Навык продавать нарабатывается только в разговорах. Вот где их берут сейчас — и что это
          стоит
        </Reveal>

        <div className="mt-9 flex flex-col gap-4 lg:mt-16 lg:flex-row lg:justify-center lg:gap-10">
          <Reveal kind="visual" className={`${CARD} border border-line`}>
            <div className={`${CAPTION} text-ink-muted`}>Сейчас</div>
            <ul className="mt-6 flex flex-col gap-6 lg:mt-[26px]">
              {NOW.map(([way, price]) => (
                <li key={way} className="flex gap-3.5">
                  <Cross />
                  <div className="min-w-0 flex-1">
                    <div className={ITEM}>{way}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="shrink-0 rounded bg-danger-soft px-[7px] py-0.5 font-mono text-[12px] font-semibold leading-[1.4] text-danger-strong">
                        ₽
                      </span>
                      <span className="font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-ink lg:text-[12px]">
                        {price}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal kind="visual" delay={300} className={`${CARD} border-[length:1.5px] border-brand`}>
            <div className={`${CAPTION} text-brand`}>С тренажёром</div>
            <ul className="mt-6 flex flex-col gap-6 lg:mt-[26px]">
              {WITH_TRAINER.map((line) => (
                <li key={line} className="flex gap-3.5">
                  <Check />
                  <div className={`min-w-0 flex-1 ${ITEM}`}>{line}</div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
