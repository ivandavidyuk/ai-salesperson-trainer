"use client";

// Первый экран: заголовок, кнопка и разговор, который идёт прямо здесь.
// Пять персонажей по очереди, у каждого своё возражение: реплика
// набирается, пауза «Слушаю вас», смена портрета — и следующий.

import { useEffect, useState } from "react";
import { portraitFor } from "@/lib/patientAvatars";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { prefersReducedMotion } from "./hooks";
import { CTA, FORM_ID, scrollToSection } from "./ui";

interface Persona {
  name: string;
  age: string;
  line: string;
}

const PERSONAS: Persona[] = [
  { name: "Тамара Михайловна", age: "62 года", line: "Дорого. У меня пенсия, а не зарплата" },
  { name: "Рустам Каримович", age: "42 года", line: "В кредит — нет. У нас в семье так не принято" },
  { name: "Юлия Андреевна", age: "34 года", line: "У меня десять минут. Сроки и цена — коротко" },
  { name: "Станислав Геннадьевич", age: "55 лет", line: "Назовите сумму целиком. Без „от“" },
  { name: "Гульсара Рустамовна", age: "25 лет", line: "Я не поняла… Это муж решает" },
];

const TYPE_MS = 36;
const LISTEN_MS = 4000;
const SWAP_MS = 440;
const START_MS = 900;

function portrait(index: number): string {
  return portraitFor(PERSONAS[index].name) ?? "";
}

type Layer = "a" | "b";

function Pill({ speaking }: { speaking: boolean }) {
  if (speaking) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-[15px] py-[7px] lg:gap-[9px] lg:px-5 lg:py-[9px]">
        <span className="h-2 w-2 rounded-full bg-brand lg:h-2.5 lg:w-2.5" />
        <span className="text-[13.5px] font-semibold text-brand-hover lg:text-[16px]">
          Говорит клиент
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface-bubble px-[15px] py-[7px] lg:gap-3 lg:px-5 lg:py-[9px]">
      <span className="flex h-[15px] items-center gap-[3px] lg:h-[18px]">
        {[0, 0.15, 0.3, 0.45, 0.6].map((delay) => (
          <span
            key={delay}
            className="h-full w-[3px] origin-center animate-barwave motion-reduce:animate-none rounded-sm bg-brand"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
      <span className="text-[13.5px] font-semibold text-brand-hover lg:text-[16px]">
        Слушаю вас
      </span>
    </span>
  );
}

export default function Hero() {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState(PERSONAS[0].line);
  const [speaking, setSpeaking] = useState(true);
  const [layers, setLayers] = useState<{ a: string; b: string; front: Layer }>({
    a: portrait(0),
    b: portrait(1),
    front: "a",
  });
  const [nameVisible, setNameVisible] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    // Портреты грузятся заранее: иначе при смене мелькал бы прежний
    PERSONAS.forEach((_, i) => {
      const image = new Image();
      image.src = portrait(i);
    });

    let cancelled = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms),
      );
    };

    // Старт со случайного персонажа: вернувшийся не видит одно и то же
    let current = Math.floor(Math.random() * PERSONAS.length);
    let front: Layer = "a";

    const type = (length: number) => {
      const line = PERSONAS[current].line;
      setText(line.slice(0, length));
      if (length < line.length) {
        later(() => type(length + 1), TYPE_MS);
      } else {
        setSpeaking(false);
        later(next, LISTEN_MS);
      }
    };

    const next = () => {
      setSpeaking(true);
      setText("");
      current = (current + 1) % PERSONAS.length;
      const back: Layer = front === "a" ? "b" : "a";
      const source = portrait(current);
      setLayers((previous) => ({ ...previous, [back]: source, front: back }));
      front = back;
      setNameVisible(false);
      const shown = current;
      later(() => {
        setIndex(shown);
        setNameVisible(true);
      }, 200);
      later(() => type(1), SWAP_MS);
    };

    later(() => {
      setLayers({ a: portrait(current), b: portrait((current + 1) % PERSONAS.length), front: "a" });
      setIndex(current);
      setSpeaking(true);
      setText("");
      type(1);
    }, START_MS);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const persona = PERSONAS[index];

  return (
    <section className="px-5 lg:px-[72px]">
      <div className="mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-[640px] flex-col pb-10 pt-[26px] lg:min-h-[calc(100svh-76px)] lg:max-w-[1296px] lg:flex-row lg:items-center lg:gap-16 lg:py-10">
        <div className="lg:w-[45%] lg:shrink-0">
          <Reveal className="font-mono text-[15.5px] font-medium uppercase tracking-[0.14em] text-brand lg:text-[17.5px] lg:tracking-[0.16em]">
            Голосовой тренажёр отдела продаж
          </Reveal>
          <Reveal
            as="h1"
            delay={60}
            className="mt-3 text-[42px] font-semibold leading-[1.06] tracking-[-0.025em] text-ink [text-wrap:pretty] lg:mt-[22px] lg:text-[clamp(60px,5.8vw,84px)] lg:leading-[1.02] lg:tracking-[-0.035em]"
          >
            Менеджеры учатся <Marker>продавать на ИИ-клиентах</Marker>, а не на ваших
            настоящих
          </Reveal>
          <Reveal delay={140} className="mt-[26px] lg:mt-11">
            <span className="relative block lg:inline-block">
              <button
                type="button"
                onClick={() => scrollToSection(FORM_ID)}
                className={`w-full lg:w-auto ${CTA}`}
              >
                Получить демо-доступ
              </button>
              <span className="pointer-events-none absolute -right-1.5 -top-[9px] rotate-[-6deg] rounded-md bg-gold-from px-[7px] py-[3px] font-mono text-[11px] font-medium uppercase leading-[1.1] tracking-[0.14em] text-ink shadow-[0_3px_9px_-3px_rgba(20,40,38,0.5)] lg:-right-4 lg:-top-[11px] lg:px-[9px] lg:py-1 lg:text-[12px]">
                Бесплатно
              </span>
            </span>
          </Reveal>
        </div>

        <div className="min-h-0 flex-1 lg:hidden" />

        <div className="mt-10 flex flex-col items-center lg:mt-0 lg:min-w-0 lg:flex-1">
          <div className="relative flex h-[200px] w-[200px] items-center justify-center lg:h-[320px] lg:w-[320px]">
            <span
              className={`absolute inset-0 transition-opacity duration-[400ms] ${
                speaking ? "opacity-100" : "opacity-0"
              }`}
            >
              <span className="absolute inset-5 animate-ringpulse motion-reduce:animate-none rounded-full border-2 border-brand lg:inset-[30px]" />
              <span
                className="absolute inset-5 animate-ringpulse motion-reduce:animate-none rounded-full border-2 border-brand lg:inset-[30px]"
                style={{ animationDelay: "1.2s" }}
              />
            </span>
            <div className="relative h-40 w-40 overflow-hidden rounded-full border-2 border-brand bg-brand-soft lg:h-[260px] lg:w-[260px]">
              {(["a", "b"] as const).map((layer) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={layer}
                  src={layers[layer]}
                  alt={layers.front === layer ? persona.name : ""}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[400ms] ${
                    layers.front === layer ? "opacity-100" : "opacity-0"
                  }`}
                />
              ))}
            </div>
          </div>
          <div
            className={`mt-3.5 text-center text-[19px] font-semibold text-ink transition-opacity duration-200 lg:mt-[22px] lg:text-[27px] ${
              nameVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {persona.name}, {persona.age}
          </div>
          <div className="mt-[9px] lg:mt-3.5">
            <Pill speaking={speaking} />
          </div>
          <div className="mt-4 min-h-[96px] text-center text-[17.5px] leading-[1.5] text-ink-body [text-wrap:pretty] lg:mt-[22px] lg:min-h-[120px] lg:max-w-[560px] lg:text-[26px] lg:leading-[1.4]">
            {text}
          </div>
        </div>
      </div>
    </section>
  );
}
