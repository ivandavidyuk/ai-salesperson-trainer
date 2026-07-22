// Аватар собеседника на экране звонка. Внешний вид зависит от того,
// что происходит в разговоре: пульсирующие кольца, пока говорит клиент;
// приглушённый круг, пока говорит менеджер; серый — на паузе.

import { initials } from "@/lib/format";

export type AvatarState = "idle" | "speaking" | "listening" | "paused";

interface CallAvatarProps {
  name: string | null;
  state: AvatarState;
  /** Крупный вариант для активного разговора во весь экран. */
  size?: "md" | "lg";
}

const SIZES = {
  md: { box: "h-[150px] w-[150px]", ring: "h-[120px] w-[120px]", face: "h-[110px] w-[110px] text-[34px]" },
  lg: { box: "h-[230px] w-[230px]", ring: "h-[180px] w-[180px]", face: "h-[168px] w-[168px] text-[52px]" },
} as const;

// Оформление круга под состояние
const FACE_TONE: Record<AvatarState, string> = {
  idle: "bg-brand-soft border-[#BCD8D3] text-brand",
  speaking: "bg-brand-soft border-brand text-brand",
  listening: "bg-surface-bubble border-[#D6E2E0] text-[#7E9491]",
  paused: "bg-surface-bubble border-line text-ink-placeholder",
};

export default function CallAvatar({
  name,
  state,
  size = "md",
}: CallAvatarProps) {
  const scale = SIZES[size];

  return (
    <div className={`relative flex items-center justify-center ${scale.box}`}>
      {/* Кольца расходятся, только когда говорит клиент */}
      {state === "speaking" && (
        <>
          <span
            className={`absolute rounded-full border-2 border-brand ${scale.ring} animate-ringpulse`}
          />
          <span
            className={`absolute rounded-full border-2 border-brand ${scale.ring} animate-ringpulse`}
            style={{ animationDelay: "1.2s" }}
          />
        </>
      )}

      <div
        className={`flex items-center justify-center rounded-full border-2 font-semibold ${scale.face} ${FACE_TONE[state]}`}
      >
        {initials(name)}
      </div>
    </div>
  );
}
