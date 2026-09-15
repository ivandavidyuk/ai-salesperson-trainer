// «После разговора видно, где менеджер не дожал»: реплики слева, разбор
// этапа справа — как на экране расшифровки в приложении. Пункты чек-листа
// и их номера настоящие (backend/services/checklist.py, этап возражений),
// оценка 5 из 10 — сумма отметок.

import { portraitFor } from "@/lib/patientAvatars";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { CTA, H2, INNER, SECTION_X } from "./ui";
import ScrollToFormButton from "./ScrollToFormButton";

type Mark = "done" | "part" | "miss";

const ITEMS: { number: number; text: string; mark: Mark }[] = [
  { number: 16, text: "Дал возражению прозвучать целиком", mark: "done" },
  { number: 17, text: "Присоединился к возражению", mark: "miss" },
  { number: 18, text: "Аргументировал", mark: "part" },
  { number: 19, text: "Побудил к действию", mark: "miss" },
  { number: 20, text: "Не спорил и не давил", mark: "done" },
];

// Пункт, на котором менеджер не дожал, — подсвечен
const FOCUS = 17;

const MARKS: Record<Mark, { dot: string; word: string; label: string }> = {
  done: { dot: "border-good bg-good", word: "text-good", label: "выполнено" },
  part: { dot: "border-warn bg-surface-card", word: "text-warn", label: "частично" },
  miss: { dot: "border-danger bg-surface-card", word: "text-danger-strong", label: "не выполнено" },
};

const BUBBLE =
  "text-[17.5px] leading-[1.45] text-ink [text-wrap:pretty] px-[18px] py-3.5 lg:px-[22px] lg:py-[18px] lg:text-[26px] lg:leading-[1.4]";

function ClientLine({ children, delay }: { children: string; delay: number }) {
  return (
    <Reveal delay={delay} className="flex max-w-[92%] items-end gap-3 self-start lg:gap-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={portraitFor("Тамара Михайловна") ?? ""}
        alt="Тамара Михайловна"
        loading="lazy"
        className="h-10 w-10 shrink-0 rounded-full object-cover lg:h-14 lg:w-14"
      />
      <div className={`rounded-[20px_20px_20px_6px] border border-line bg-surface-bubble ${BUBBLE}`}>
        {children}
      </div>
    </Reveal>
  );
}

export default function Review() {
  return (
    <section className={`${SECTION_X} border-y border-line bg-surface-card py-11 lg:py-24`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-9 lg:mb-14 lg:max-w-[1100px]`}>
          После разговора видно, где менеджер <Marker>не дожал</Marker>
        </Reveal>

        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex flex-col justify-center gap-4 lg:w-[46%] lg:shrink-0 lg:gap-5 lg:pr-[52px]">
            <ClientLine delay={0}>
              Дорого. Соседке в другой клинике то же самое сделали вдвое дешевле
            </ClientLine>
            <Reveal
              delay={250}
              className={`max-w-[82%] self-end rounded-[20px_20px_6px_20px] bg-brand !text-white ${BUBBLE}`}
            >
              У нас материалы лучше и гарантия три года, поэтому цена такая
            </Reveal>
            <ClientLine delay={500}>Ну, гарантия… Я с мужем посоветуюсь и позвоню</ClientLine>
          </div>

          <div className="my-8 h-px shrink-0 bg-line lg:my-0 lg:h-auto lg:w-px" />

          <div className="flex min-w-0 flex-1 flex-col justify-center lg:pl-[52px]">
            <Reveal delay={700} className="mb-4 lg:mb-5">
              <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-brand-hover lg:text-[13px]">
                Разбор
              </div>
            </Reveal>
            <Reveal
              kind="visual"
              delay={700}
              className="rounded-[18px] border border-line bg-surface-card p-5 shadow-card lg:px-7 lg:py-[26px]"
            >
              <div className="flex items-baseline gap-2.5">
                <span className="min-w-0 flex-1 text-[18px] font-semibold text-ink lg:text-[20px]">
                  Отработка возражений
                </span>
                <span className="font-mono text-[20px] font-semibold text-ink lg:text-[22px]">5</span>
                <span className="font-mono text-[15px] text-ink-placeholder lg:text-[16px]">/ 10</span>
              </div>
              <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-line-soft">
                <div className="h-full w-1/2 rounded-full bg-brand" />
              </div>

              <ul className="mt-5 rounded-xl border border-line-soft bg-surface px-3.5 pb-2.5 pt-1 lg:px-[18px]">
                {ITEMS.map((item, i) => {
                  const mark = MARKS[item.mark];
                  const focus = item.number === FOCUS;
                  return (
                    <Reveal
                      as="li"
                      key={item.number}
                      delay={760 + i * 110}
                      className={
                        focus
                          ? "-mx-3.5 my-1 flex items-center gap-3 rounded-[10px] border-[length:1.5px] border-danger-border bg-danger-wash px-3.5 py-[13px]"
                          : "flex items-center gap-3 border-t border-line-soft py-3.5 first:border-t-0"
                      }
                    >
                      <span className="w-5 shrink-0 font-mono text-[13.5px] text-ink-placeholder lg:text-[14px]">
                        {item.number}
                      </span>
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full border-[length:1.5px] ${mark.dot}`}
                      />
                      <span
                        className={`min-w-0 flex-1 text-[15.5px] leading-[1.35] text-ink [text-wrap:pretty] lg:text-[17px] ${
                          focus ? "font-semibold" : ""
                        }`}
                      >
                        {item.text}
                      </span>
                      <span
                        className={`shrink-0 text-[13.5px] lg:text-[14.5px] ${mark.word} ${
                          focus ? "font-semibold" : ""
                        }`}
                      >
                        {mark.label}
                      </span>
                    </Reveal>
                  );
                })}
              </ul>
            </Reveal>
          </div>
        </div>

        <p className="mt-10 max-w-[700px] text-[13.5px] leading-[1.5] text-ink-subtle [text-wrap:pretty] lg:mt-11 lg:text-[14px]">
          Пример из стоматологической клиники. Под вашу отрасль тренажёр собирается со своими
          клиентами и услугами
        </p>
        <div className="mt-8 flex justify-center lg:mt-11">
          <ScrollToFormButton className={`w-full lg:w-auto ${CTA}`} />
        </div>
      </div>
    </section>
  );
}
