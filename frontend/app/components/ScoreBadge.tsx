// Бейдж оценки разговора. Оформление зависит от значения — пороги взяты
// из макета: 10 — золотой, от 8 — зелёный, от 6.2 — тиловый, ниже — янтарный.

import { scoreTone } from "@/lib/score";

interface ScoreBadgeProps {
  score: number | null;
}

export default function ScoreBadge({ score }: ScoreBadgeProps) {
  // Разбора ещё нет — показываем нейтральную заглушку вместо пустоты
  if (score === null) {
    return (
      <span className="shrink-0 rounded-full bg-surface-bubble px-2.5 py-1 text-[11px] font-medium text-ink-subtle">
        без оценки
      </span>
    );
  }

  const text = `${score} / 10`;

  if (score >= 10) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-br from-gold-from to-gold-to px-[11px] py-1 text-[11px] font-bold text-gold-text shadow-[inset_0_1px_0_rgba(255,255,255,.55),0_2px_6px_-2px_rgba(199,150,43,.6)]">
        {text}
      </span>
    );
  }

  const toneClass = {
    gold: "",
    good: "bg-good-surface text-good",
    brand: "bg-brand-soft text-brand-hover",
    warn: "bg-warn-surface text-warn",
    bad: "bg-danger-soft text-danger-strong",
  }[scoreTone(score)];

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}
    >
      {text}
    </span>
  );
}
