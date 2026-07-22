// Индикатор того, кто сейчас на линии — главный смысловой элемент
// экрана звонка. Говорит клиент: тиловая точка. Слушаю вас: эквалайзер
// из полосок. На паузе — нейтральная плашка.

type SpeakerState = "speaking" | "listening" | "paused";

interface SpeakerPillProps {
  state: SpeakerState;
  /** Крупный вариант для активного разговора во весь экран. */
  size?: "md" | "lg";
}

export default function SpeakerPill({ state, size = "md" }: SpeakerPillProps) {
  const pad = size === "lg" ? "px-[18px] py-2" : "px-3.5 py-1.5";
  const text = size === "lg" ? "text-[15px]" : "text-sm";

  if (state === "paused") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full border border-line bg-surface ${pad}`}
      >
        <span className={`font-semibold text-ink-muted ${text}`}>На паузе</span>
      </div>
    );
  }

  if (state === "speaking") {
    return (
      <div className={`inline-flex items-center gap-2 rounded-full bg-brand-soft ${pad}`}>
        <span
          className={`inline-block rounded-full bg-brand ${
            size === "lg" ? "h-[9px] w-[9px]" : "h-2 w-2"
          }`}
        />
        <span className={`font-semibold text-brand-hover ${text}`}>
          Говорит клиент
        </span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-full border border-line bg-surface ${pad}`}
    >
      {/* Эквалайзер: полоски с разной задержкой создают «волну» */}
      <span className="flex h-[18px] items-center gap-[3px]">
        {[0, 0.15, 0.3, 0.45, 0.6].map((delay) => (
          <span
            key={delay}
            className="w-[3px] origin-center rounded-sm bg-brand animate-barwave"
            style={{ height: "100%", animationDelay: `${delay}s` }}
          />
        ))}
      </span>
      <span className={`font-semibold text-brand-hover ${text}`}>Слушаю вас</span>
    </div>
  );
}
