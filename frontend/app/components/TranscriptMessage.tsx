// Реплика в расшифровке разговора: клиент слева белым пузырём,
// менеджер справа тиловым. Под пузырём — кто говорил и на какой
// секунде разговора.

import { formatDuration, initials } from "@/lib/format";
import PatientAvatar from "@/app/components/PatientAvatar";

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
      {/* Портрет только у клиента: у менеджера здесь его собственные инициалы,
          а своё фото он видит в профиле */}
      {isManager ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-[12.5px] font-semibold text-white">
          {initials(speakerName)}
        </span>
      ) : (
        <PatientAvatar
          name={speakerName}
          className="h-8 w-8 bg-brand-soft text-[12.5px] font-semibold text-brand"
          lazy
        />
      )}

      <div className="max-w-[74%]">
        {/* Скруглённый угол «смотрит» на аватар — так видно, кто говорит */}
        <div
          className={`px-[15px] py-3 text-[16px] leading-normal ${
            isManager
              ? "rounded-[14px_14px_4px_14px] bg-brand text-white"
              : "rounded-[14px_14px_14px_4px] border border-line bg-surface-card text-ink"
          }`}
        >
          {text}
        </div>
        <div
          className={`mt-[5px] font-mono text-[12.5px] text-ink-subtle ${
            isManager ? "text-right" : ""
          }`}
        >
          {isManager ? "Менеджер" : "Клиент"} · {formatDuration(offsetSec)}
        </div>
      </div>
    </div>
  );
}
