"use client";

// «Знакомо?» — три боли, по одной на экран.
//
// На десктопе секция закреплена на три экрана, и высказывания сменяют друг
// друга по прокрутке. На телефоне закрепление неудобно — три карточки
// одна под другой.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { H2, INNER, SECTION_X } from "./ui";

const STATEMENTS: ((active?: boolean) => ReactNode)[] = [
  (active) => (
    <>
      Новичок выходит на клиентов через неделю после найма — и{" "}
      <Marker active={active}>первые сделки срываются</Marker>
    </>
  ),
  (active) => (
    <>
      Об ошибке менеджера вы узнаёте последним: <Marker active={active}>клиент</Marker> не
      жалуется, он просто{" "}
      <Marker active={active} duration={450}>
        не возвращается
      </Marker>
    </>
  ),
  (active) => (
    <>
      Тренинг прошёл — через месяц <Marker active={active}>всё как было</Marker>
    </>
  ),
];

const HEADER_HEIGHT = 76;

function Pinned() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<number[]>([]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const stage = window.innerHeight - HEADER_HEIGHT;
      const span = Math.max(1, rect.height - stage);
      const progress = Math.min(1, Math.max(0, (HEADER_HEIGHT - rect.top) / span));
      const index = Math.min(
        STATEMENTS.length - 1,
        Math.floor(progress * (STATEMENTS.length - 0.001)),
      );
      setActive(index);
      // Маркер проводится, когда высказывание действительно на экране
      if (rect.top < window.innerHeight * 0.6) {
        setSeen((previous) => (previous.includes(index) ? previous : [...previous, index]));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={boxRef} className="relative hidden h-[300svh] lg:block">
      <div className="sticky top-[76px] mx-auto flex h-[calc(100svh-76px)] max-w-[1440px] items-center gap-[72px] px-[72px]">
        <div className="w-[34%] shrink-0">
          <h2 className={H2}>Знакомо?</h2>
          <div className="mt-[34px] flex gap-2.5">
            {STATEMENTS.map((_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
                  i === active ? "bg-brand" : "bg-line-strong"
                }`}
              />
            ))}
          </div>
        </div>
        <div className="relative h-[420px] min-w-0 flex-1">
          {STATEMENTS.map((render, i) => {
            const offset = i === active ? 0 : i < active ? -56 : 56;
            return (
              <div
                key={i}
                aria-hidden={i !== active}
                className="absolute inset-x-0 top-1/2 transition-[transform,opacity] duration-[400ms] ease-out motion-reduce:transition-none"
                style={{
                  opacity: i === active ? 1 : 0,
                  transform: `translateY(calc(-50% + ${offset}px))`,
                }}
              >
                <p className="text-[clamp(34px,3.1vw,44px)] font-medium leading-[1.18] tracking-[-0.025em] text-ink [text-wrap:pretty]">
                  {render(seen.includes(i))}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Cards() {
  return (
    <section className={`${SECTION_X} pb-10 lg:hidden`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-[18px]`}>
          Знакомо?
        </Reveal>
        <div className="flex flex-col gap-4">
          {STATEMENTS.map((render, i) => (
            <Reveal
              key={i}
              className="flex min-h-[470px] items-center rounded-[20px] border border-line bg-surface-card px-5 py-[30px]"
            >
              <p className="text-[30px] font-medium leading-[1.2] tracking-[-0.015em] text-ink [text-wrap:pretty]">
                {render()}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Familiar() {
  return (
    <>
      <Cards />
      <Pinned />
    </>
  );
}
