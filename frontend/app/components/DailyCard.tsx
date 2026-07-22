"use client";

// Карточка «Совет дня», которая раз в 30 секунд сменяется «Мотивацией».
// Сами тексты меняются раз в сутки — это решает сервер (см. lib/home.ts),
// здесь только переключение между двумя карточками.

import { useEffect, useState } from "react";

// Период смены из макета
const ROTATE_MS = 30_000;

interface DailyCardProps {
  tip: string | null;
  motivation: string | null;
}

export default function DailyCard({ tip, motivation }: DailyCardProps) {
  const [showTip, setShowTip] = useState(true);

  // Если заполнен только один вид контента, крутить нечего
  const canRotate = Boolean(tip) && Boolean(motivation);

  useEffect(() => {
    if (!canRotate) return;
    const timer = setInterval(() => setShowTip((value) => !value), ROTATE_MS);
    return () => clearInterval(timer);
  }, [canRotate]);

  const tipVisible = canRotate ? showTip : Boolean(tip);

  if (!tip && !motivation) {
    return (
      <div className="flex flex-1 flex-col rounded-card border border-line bg-surface-card px-5 py-[18px]">
        <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-ink-subtle">
          Совет дня
        </div>
        <div className="mt-2.5 text-[13.5px] leading-normal text-ink-subtle">
          Появится, как только добавим подборку советов.
        </div>
      </div>
    );
  }

  if (tipVisible) {
    return (
      <div className="flex flex-1 flex-col rounded-card border border-line bg-surface-card px-5 py-[18px]">
        <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-brand-hover">
          Совет дня
        </div>
        <div className="mt-2.5 text-pretty text-[13.5px] leading-normal text-ink-body">
          {tip}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col rounded-card bg-surface-dark px-5 py-[18px]">
      <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-brand-on-dark">
        Мотивация
      </div>
      <div className="mt-2.5 text-pretty text-[13.5px] leading-normal text-brand-text-on-dark">
        {motivation}
      </div>
    </div>
  );
}
