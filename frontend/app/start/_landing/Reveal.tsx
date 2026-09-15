"use client";

// Въезд блока при прокрутке. Текст приезжает слева, визуал — справа,
// на телефоне визуал поднимается снизу: в одну колонку «справа» некуда.
//
// Блоки, видимые сразу при загрузке, не прячутся вовсе: иначе первый экран
// мигнул бы — отрисовался, исчез и въехал. Без скрипта всё видно.

import { createElement, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useInView } from "./hooks";

type Tag = "div" | "span" | "p" | "h1" | "h2" | "li";

interface RevealProps {
  children: ReactNode;
  kind?: "text" | "visual";
  /** Задержка, мс — для каскада соседних блоков */
  delay?: number;
  className?: string;
  as?: Tag;
  id?: string;
}

const EASE = "cubic-bezier(.16,.84,.34,1)";

export default function Reveal({
  children,
  kind = "text",
  delay = 0,
  className = "",
  as = "div",
  id,
}: RevealProps) {
  const [ref, inView] = useInView<HTMLElement>();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top > window.innerHeight * 0.88) setArmed(true);
  }, [ref]);

  const hidden = armed && !inView;
  const shift =
    kind === "text"
      ? "-translate-x-10"
      : "translate-y-8 lg:translate-x-10 lg:translate-y-0";
  const wait = delay + (kind === "visual" ? 120 : 0);
  const style: CSSProperties | undefined = armed
    ? {
        transition: `opacity 550ms ${EASE} ${wait}ms, transform 550ms ${EASE} ${wait}ms`,
      }
    : undefined;

  return createElement(
    as,
    { ref, id, className: `${className} ${hidden ? `opacity-0 ${shift}` : ""}`, style },
    children,
  );
}
