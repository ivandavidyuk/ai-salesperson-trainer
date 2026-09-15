"use client";

// «Собирается под вашу отрасль» — карточки клиентов из разных отраслей
// сменяют друг друга. Смена раз в 6 секунд; стрелки, точки и свайп
// переключают вручную, и после этого автосмена молчит 20 секунд — чтобы
// человек дочитал карточку своей отрасли.

import { useEffect, useRef, useState } from "react";
import { portraitFor } from "@/lib/patientAvatars";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { usePrefersReducedMotion } from "./hooks";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

type Level = "easy" | "mid" | "hard";

const CARDS: { industry: string; name: string; age: string; level: Level; text: string }[] = [
  {
    industry: "Офтальмология",
    name: "Тамара Михайловна",
    age: "62 года",
    level: "mid",
    text: "Начальная катаракта. Вблизи в очках не видит, вязать и читать стало тяжело; за диагностику уже заплатила",
  },
  {
    industry: "Недвижимость",
    name: "Елена Андреевна",
    age: "34 года",
    level: "mid",
    text: "Управляет отелем в Сочи, покупает квартиру у моря под сдачу. Сравнивает три ЖК и торгуется за каждый метр",
  },
  {
    industry: "Автосалон",
    name: "Рустам Каримович",
    age: "42 года",
    level: "hard",
    text: "Меняет машину для семьи из пяти человек. Кредит для него закрыт, рассрочка от салона — можно; решает вместе с женой",
  },
  {
    industry: "Фитнес",
    name: "Юлия Андреевна",
    age: "34 года",
    level: "easy",
    text: "Хочет клуб рядом с работой. Дважды бросала абонементы и платить за год вперёд отказывается",
  },
  {
    industry: "Ремонт квартир",
    name: "Станислав Геннадьевич",
    age: "55 лет",
    level: "hard",
    text: "Ремонт в новостройке под ключ. Пока не услышал смету целиком, предоплату не обсуждает",
  },
];

const LEVELS: Record<Level, { label: string; badge: string; dot: string }> = {
  easy: { label: "Лёгкий", badge: "bg-good-surface text-good", dot: "bg-good" },
  mid: { label: "Средний", badge: "bg-warn-surface text-warn", dot: "bg-warn" },
  hard: { label: "Сложный", badge: "bg-danger-soft text-danger", dot: "bg-danger" },
};

const AUTO_MS = 6000;
const HOLD_MS = 20000;

function Arrow({ direction, onClick }: { direction: -1 | 1; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction < 0 ? "Предыдущий клиент" : "Следующий клиент"}
      className="h-11 w-11 shrink-0 rounded-full border-[length:1.5px] border-line-strong bg-surface-card text-[24px] leading-none text-ink transition-colors hover:border-brand hover:text-brand"
    >
      {direction < 0 ? "‹" : "›"}
    </button>
  );
}

export default function Industries() {
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState(-1);
  const reduced = usePrefersReducedMotion();
  const indexRef = useRef(0);
  const hoverRef = useRef(false);
  const holdUntilRef = useRef(0);
  const touchXRef = useRef<number | null>(null);

  const show = (next: number) => {
    setPrevious(indexRef.current);
    indexRef.current = (next + CARDS.length) % CARDS.length;
    setIndex(indexRef.current);
  };

  const go = (next: number, manual: boolean) => {
    show(next);
    if (manual) holdUntilRef.current = Date.now() + HOLD_MS;
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (hoverRef.current || Date.now() < holdUntilRef.current) return;
      setPrevious(indexRef.current);
      indexRef.current = (indexRef.current + 1) % CARDS.length;
      setIndex(indexRef.current);
    }, AUTO_MS);
    return () => window.clearInterval(timer);
  }, []);

  const dots = (
    <div className="flex justify-center gap-1.5">
      {CARDS.map((card, i) => (
        <button
          key={card.industry}
          type="button"
          aria-label={card.industry}
          aria-current={i === index}
          onClick={() => go(i, true)}
          className="inline-flex h-6 w-6 items-center justify-center"
        >
          <span
            className={`block h-[9px] w-[9px] rounded-full transition-colors duration-300 ${
              i === index ? "bg-brand" : "bg-line-strong"
            }`}
          />
        </button>
      ))}
    </div>
  );

  return (
    <section className={`${SECTION_X} ${SCREEN} py-11 lg:py-[100px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-9 lg:mb-14 lg:max-w-[1150px]`}>
          Собирается <Marker>под вашу отрасль</Marker>: ваши услуги, ваши цены, ваши клиенты
        </Reveal>

        <div className="flex items-center justify-center gap-7">
          <span className="hidden lg:block">
            <Arrow direction={-1} onClick={() => go(index - 1, true)} />
          </span>
          <Reveal
            kind="visual"
            delay={80}
            className="grid w-full lg:w-[760px]"
          >
            <div
              className="grid"
              onMouseEnter={() => {
                hoverRef.current = true;
              }}
              onMouseLeave={() => {
                hoverRef.current = false;
                holdUntilRef.current = Date.now() + HOLD_MS;
              }}
              onTouchStart={(event) => {
                touchXRef.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                const start = touchXRef.current;
                const end = event.changedTouches[0]?.clientX;
                touchXRef.current = null;
                if (start == null || end == null || Math.abs(end - start) < 40) return;
                go(end < start ? index + 1 : index - 1, true);
              }}
            >
              {CARDS.map((card, i) => {
                const level = LEVELS[card.level];
                const active = i === index;
                const transform = active ? "none" : i === previous ? "scale(0.94)" : "translateY(24px)";
                return (
                  <article
                    key={card.industry}
                    aria-hidden={!active}
                    className="rounded-[20px] border border-line bg-surface-card p-6 shadow-[0_22px_50px_-32px_rgba(20,40,38,0.35)] [grid-area:1/1] lg:p-8"
                    style={{
                      opacity: active ? 1 : 0,
                      transform,
                      pointerEvents: active ? "auto" : "none",
                      transition: reduced ? "none" : "opacity 500ms ease, transform 500ms ease",
                    }}
                  >
                    <div className="inline-block rounded-md bg-brand-soft px-[11px] py-1.5 font-mono text-[13.5px] font-medium uppercase tracking-[0.16em] text-brand lg:text-[15.5px]">
                      {card.industry}
                    </div>
                    <div className="mt-3 flex items-center gap-4 lg:gap-5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={portraitFor(card.name) ?? ""}
                        alt={card.name}
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-full object-cover lg:h-[86px] lg:w-[86px]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[21px] font-semibold text-ink lg:text-[26px]">{card.name}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="text-[16px] text-ink-subtle lg:text-[19px]">{card.age}</span>
                          <span className="text-[16px] text-line-strong lg:text-[19px]">·</span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-[5px] text-[13.5px] font-semibold lg:text-[15px] ${level.badge}`}
                          >
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${level.dot}`} />
                            {level.label}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="mt-6 text-[17px] leading-[1.5] text-ink-muted [text-wrap:pretty] lg:text-[19px]">
                      {card.text}
                    </p>
                  </article>
                );
              })}
            </div>
          </Reveal>
          <span className="hidden lg:block">
            <Arrow direction={1} onClick={() => go(index + 1, true)} />
          </span>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3 lg:mt-[22px]">
          <span className="lg:hidden">
            <Arrow direction={-1} onClick={() => go(index - 1, true)} />
          </span>
          {dots}
          <span className="lg:hidden">
            <Arrow direction={1} onClick={() => go(index + 1, true)} />
          </span>
        </div>
        <p className="mt-[18px] text-center text-[13.5px] text-ink-subtle lg:text-[14px]">
          Персонажи и случаи под вашу отрасль пишутся при подключении
        </p>
      </div>
    </section>
  );
}
