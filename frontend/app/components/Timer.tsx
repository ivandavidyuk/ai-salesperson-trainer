// Таймер разговора в топбаре экрана звонка.
// Во время записи — красная точка, на паузе — значок паузы и приглушённый вид.

import { formatDuration } from "@/lib/format";

interface TimerProps {
  seconds: number;
  paused?: boolean;
  /** Крупный вариант для активного разговора во весь экран. */
  size?: "md" | "lg";
}

export default function Timer({ seconds, paused = false, size = "md" }: TimerProps) {
  const scale =
    size === "lg" ? "px-4 py-[7px] text-base" : "px-[13px] py-[5px] text-[15px]";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-surface font-mono tabular-nums ${scale} ${
        paused ? "text-ink-subtle" : "text-ink"
      }`}
    >
      {paused ? (
        <span aria-hidden="true">⏸</span>
      ) : (
        // Красная точка — привычный признак идущей записи
        <span
          className={`inline-block rounded-full bg-danger ${
            size === "lg" ? "h-2 w-2" : "h-[7px] w-[7px]"
          }`}
        />
      )}
      {formatDuration(seconds)}
    </div>
  );
}
