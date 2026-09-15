"use client";

// «Как это выглядит» — фото менеджера за разговором с тренажёром.
// Видео Дима ещё снимает: пока кнопка «Смотреть» открывает окно «скоро»
// (решение Ивана 15.09). Когда видео появится, окно заменит плеер.

import { useEffect, useState } from "react";
import Reveal from "./Reveal";
import { CTA, H2, INNER, SCREEN, SECTION_X } from "./ui";

function VideoSoon({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 px-5"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-soon-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[420px] rounded-card bg-surface-card p-7 text-center shadow-card"
      >
        <h3 id="video-soon-title" className="text-[24px] font-semibold text-ink">
          Видео скоро появится
        </h3>
        <p className="mt-2.5 text-[17.5px] leading-[1.5] text-ink-muted">
          Снимаем настоящий разговор менеджера с ИИ-клиентом
        </p>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <button type="button" autoFocus onClick={onClose} className={`mt-6 w-full ${CTA}`}>
          Понятно
        </button>
      </div>
    </div>
  );
}

// Фото не выше 62% окна: заголовок и фото помещаются в один экран
const FRAME = "w-full lg:w-[min(837px,93svh)]";

export default function HowItLooks() {
  const [open, setOpen] = useState(false);

  return (
    <section className={`${SECTION_X} ${SCREEN} py-11`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} mb-7 lg:mb-11`}>
          Как это выглядит
        </Reveal>
        <Reveal
          kind="visual"
          delay={80}
          className={`relative mx-auto aspect-[3/2] overflow-hidden rounded-[18px] bg-line lg:rounded-[24px] ${FRAME}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/landing/photo-manager-laptop.jpg"
            alt="Менеджер в наушниках говорит с ИИ-клиентом"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full bg-brand px-[22px] py-[13px] text-[16px] font-semibold text-white shadow-[0_14px_34px_-14px_rgba(8,20,18,0.85)] transition-colors hover:bg-brand-hover lg:gap-[13px] lg:px-8 lg:py-[17px] lg:text-[20px]"
          >
            <svg width="14" height="16" viewBox="0 0 13 15" fill="currentColor" aria-hidden>
              <path d="M0 0l13 7.5L0 15z" />
            </svg>
            Смотреть
          </button>
        </Reveal>
        <p className={`mx-auto mt-4 text-center text-[13.5px] text-ink-subtle lg:text-[14px] ${FRAME}`}>
          Запись разговора с ИИ-клиентом
        </p>
      </div>
      {open && <VideoSoon onClose={() => setOpen(false)} />}
    </section>
  );
}
