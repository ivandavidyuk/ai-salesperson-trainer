// «Что получает отдел» — две полосы: менеджер и руководитель, у каждой
// фрагмент интерфейса крупно.

import Marker from "./Marker";
import Reveal from "./Reveal";
import { H2, INNER, SECTION_X } from "./ui";

const EXERCISE = [
  { number: 11, text: "Задал открытый вопрос о жалобе", done: true },
  { number: 12, text: "Спросил, как это мешает в жизни", done: true },
  { number: 13, text: "Услышал страх, а не только симптом", done: true },
  { number: 14, text: "Проверил, что понял правильно", done: true },
  { number: 15, text: "Не назвал цену раньше времени", done: false },
];

const STAGES = [
  { name: "Установка контакта", score: 7.8 },
  { name: "«Топка льда»", score: 6.9 },
  { name: "Выявление потребности", score: 6.2 },
  { name: "Отработка возражений", score: 5.5 },
  { name: "Закрытие сделки", score: 4.9 },
];

const TEXT =
  "text-[26px] font-medium leading-[1.18] tracking-[-0.025em] text-ink [text-wrap:pretty] lg:w-[40%] lg:shrink-0 lg:text-[clamp(32px,2.8vw,40px)]";
const CARD =
  "min-w-0 rounded-[20px] border border-line bg-surface-card p-5 lg:flex-1 lg:px-[34px] lg:py-[30px]";
const ROW = "flex flex-col gap-7 py-10 lg:min-h-[740px] lg:flex-row lg:items-center lg:gap-[72px] lg:py-0";

function ExerciseCard() {
  return (
    <>
      <div className="flex items-center gap-4 lg:gap-[18px]">
        <div className="relative h-16 w-16 shrink-0 lg:h-[78px] lg:w-[78px]">
          <svg viewBox="0 0 56 56" className="block h-full w-full -rotate-90" aria-hidden>
            <circle cx="28" cy="28" r="24" fill="none" className="stroke-brand-soft" strokeWidth="4" />
            <circle
              cx="28"
              cy="28"
              r="24"
              fill="none"
              className="stroke-brand"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="135.7 150.8"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-[20px] font-semibold text-ink lg:text-[24px]">
            9
          </span>
        </div>
        <div>
          <div className="text-[18px] font-semibold text-ink lg:text-[21px]">Оценка за упражнение</div>
          <div className="mt-0.5 text-[15.5px] text-ink-subtle lg:text-[17px]">один этап, из 10</div>
        </div>
      </div>
      <div className="mt-5 border-t border-line-soft pt-[18px] text-[17px] text-ink lg:text-[19px]">
        Выполнено <b>4 из 5</b> пунктов
      </div>
      <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-line-soft">
        <div className="h-full w-4/5 rounded-full bg-brand" />
      </div>
      <ul className="mt-5 rounded-[14px] border border-line-soft bg-surface px-3.5 pb-3 pt-1 lg:px-5">
        {EXERCISE.map((item) => (
          <li
            key={item.number}
            className="flex items-center gap-3 border-t border-line-soft py-3.5 first:border-t-0 lg:gap-3.5"
          >
            <span className="w-[22px] shrink-0 font-mono text-[13.5px] text-ink-placeholder lg:text-[15px]">
              {item.number}
            </span>
            <span
              className={`h-[11px] w-[11px] shrink-0 rounded-full border-[length:1.5px] ${
                item.done ? "border-brand bg-brand" : "border-line-strong bg-surface-card"
              }`}
            />
            <span className="min-w-0 flex-1 text-[15.5px] text-ink lg:text-[19px]">{item.text}</span>
            <span
              className={`shrink-0 text-[13.5px] lg:text-[16px] ${
                item.done ? "text-brand-hover" : "text-ink-subtle"
              }`}
            >
              {item.done ? "выполнено" : "не выполнено"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatsCard() {
  return (
    <>
      <div className="flex items-center gap-4 border-b border-line-soft pb-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/landing/rop-irina.jpg"
          alt="Ирина П."
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-full object-cover lg:h-14 lg:w-14"
        />
        <div>
          <div className="text-[18px] font-semibold text-ink lg:text-[21px]">Ирина П.</div>
          <div className="mt-0.5 text-[15.5px] text-ink-subtle lg:text-[17px]">
            Менеджер · офтальмология
          </div>
        </div>
      </div>
      <div className="mb-[18px] mt-5 font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-brand-hover lg:text-[13px]">
        Прогресс по этапам
      </div>
      <div className="flex flex-col gap-4">
        {STAGES.map((stage, i) => {
          const weakest = i === STAGES.length - 1;
          return (
            <div
              key={stage.name}
              className={
                weakest
                  ? "-mx-4 rounded-xl border-[length:1.5px] border-danger-border bg-danger-wash px-4 py-3.5"
                  : ""
              }
            >
              <div className="mb-[7px] flex items-center justify-between">
                <span
                  className={`text-[16px] lg:text-[19px] ${
                    weakest ? "font-semibold text-ink" : "text-ink-body"
                  }`}
                >
                  {stage.name}
                </span>
                <span
                  className={`font-mono text-[16px] lg:text-[19px] ${
                    weakest ? "font-semibold text-danger-strong" : "text-ink"
                  }`}
                >
                  {stage.score.toFixed(1)}
                </span>
              </div>
              <div
                className={`h-2 overflow-hidden rounded-full ${weakest ? "bg-danger-soft" : "bg-line-soft"}`}
              >
                <div
                  className={`h-full rounded-full ${weakest ? "bg-danger" : "bg-brand"}`}
                  style={{ width: `${stage.score * 10}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function DeptGets() {
  return (
    <section className={`${SECTION_X} pb-6 pt-11 lg:pb-[60px] lg:pt-[100px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={H2}>
          Что получает отдел
        </Reveal>

        <div className={ROW}>
          <Reveal className={TEXT}>
            Менеджер тренируется, пока не получится. <Marker>Ошибка ничего не стоит</Marker>
          </Reveal>
          <Reveal kind="visual" delay={160} className={CARD}>
            <ExerciseCard />
          </Reveal>
        </div>

        <div className={ROW}>
          <Reveal className={`${TEXT} lg:order-2`}>
            Руководитель видит, где отдел <Marker>теряет сделки</Marker>, — не слушая записи
          </Reveal>
          <Reveal kind="visual" delay={160} className={`${CARD} lg:order-1`}>
            <StatsCard />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
