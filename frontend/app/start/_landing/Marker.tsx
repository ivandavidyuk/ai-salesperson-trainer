"use client";

// Выделение маркером: ровная жёлтая полоса за словами, проводится слева
// направо, когда слова появились.
//
// Геометрия считается от кегля и межстрочья: полоса выступает над буквами
// и под ними на 8% кегля, но не больше половины межстрочья — иначе полосы
// соседних строк сливаются, а полоса задевает буквы строки выше. Каждая
// строка получает свою полосу со своими скруглениями (box-decoration-break).

import { useEffect, useState, type ReactNode } from "react";
import { useInView, usePrefersReducedMotion } from "./hooks";

const STRIPE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 40' preserveAspectRatio='none'%3E%3Crect width='200' height='40' rx='3' ry='3' fill='%23F4D67E' fill-opacity='.85'/%3E%3C/svg%3E\")";

interface Geometry {
  pad: number;
  height: number;
  offset: number;
}

function measure(element: HTMLElement): Geometry {
  const style = window.getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize) || 16;
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
  const ink = fontSize * 0.93;
  const over = Math.max(0, Math.min(fontSize * 0.08, (lineHeight - ink) * 0.45));
  return { pad: over, height: ink + over * 2, offset: fontSize * 0.07 };
}

interface MarkerProps {
  children: ReactNode;
  /** Кто решает, когда провести полосу. Без него — появление в экране */
  active?: boolean;
  delay?: number;
  duration?: number;
}

export default function Marker({ children, active, delay = 220, duration = 500 }: MarkerProps) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const reduced = usePrefersReducedMotion();
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  // Кегль меняется на границе телефона и десктопа — пересчитываем
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setGeometry(measure(element));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ref]);

  const on = active ?? inView;
  const height = geometry ? `${geometry.height.toFixed(1)}px` : "1.01em";

  return (
    <span
      ref={ref}
      className="text-ink"
      style={{
        backgroundImage: STRIPE,
        backgroundRepeat: "no-repeat",
        backgroundPosition: geometry
          ? `0 calc(100% - ${geometry.offset.toFixed(1)}px)`
          : "0 calc(100% - 0.07em)",
        backgroundSize: `${on ? 100 : 0}% ${height}`,
        padding: `${geometry ? `${geometry.pad.toFixed(1)}px` : "0.04em"} 0.15em`,
        WebkitBoxDecorationBreak: "clone",
        boxDecorationBreak: "clone",
        transition: reduced ? "none" : `background-size ${duration}ms ease ${delay}ms`,
      }}
    >
      {children}
    </span>
  );
}
