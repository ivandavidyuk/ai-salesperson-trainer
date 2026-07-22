// Реплика в расшифровке разговора: клиент слева белым пузырём,
// менеджер справа тиловым. Под пузырём — кто говорил и на какой
// секунде разговора.

import { formatDuration, initials } from "@/lib/format";

interface TranscriptBubbleProps {
  /** Реплика менеджера (наша) или клиента */
  isManager: boolean;
  text: string;
  /** Имя для инициалов в аватаре */
  speakerName: string | null;
  /** Секунды от начала разговора */
  offsetSec: number;
}

export default function TranscriptMessage({
  isManager,
  text,
  speakerName,
  offsetSec,
}: TranscriptBubbleProps) {
  return (
    <div
      className={`mb-[18px] flex items-end gap-3 ${
        isManager ? "flex-row-reverse" : ""
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          isManager ? "bg-brand text-white" : "bg-brand-soft text-brand"
        }`}
      >
        {initials(speakerName)}
      </span>

      <div className="max-w-[74%]">
        {/* Скруглённый угол «смотрит» на аватар — так видно, кто говорит */}
        <div
          className={`px-[15px] py-3 text-[14.5px] leading-normal ${
            isManager
              ? "rounded-[14px_14px_4px_14px] bg-brand text-white"
              : "rounded-[14px_14px_14px_4px] border border-line bg-surface-card text-ink"
          }`}
        >
          {text}
        </div>
        <div
          className={`mt-[5px] font-mono text-[11px] text-ink-subtle ${
            isManager ? "text-right" : ""
          }`}
        >
          {isManager ? "Менеджер" : "Клиент"} · {formatDuration(offsetSec)}
        </div>
      </div>
    </div>
  );
}
