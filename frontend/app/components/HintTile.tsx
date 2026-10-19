// Плитка «пиктограмма + пара слов» и пиктограммы справки «Как пользоваться»:
// ряд под шагом «Говорите» и «Если что-то пошло не так».
//
// Картинкой, а не абзацем: первый заход 19.10 был текстом, и Иван отверг
// его целиком — менеджеры занимаются с телефона между делом, абзац
// не читает никто. Подпись — не длиннее пяти слов.

import type { ReactNode } from "react";

/** Пиктограммы обучения: контурные 24×24, линия 1.8, как в рейке */
export const пиктограммы = {
  // Второе облачко залито фоном плитки: оно ложится поверх первого
  перебить: (
    <>
      <path d="M3 4h11v7H8l-3 3v-3H3z" />
      <path d="M10 9h11v7h-2v3l-3-3h-6z" className="fill-surface" />
    </>
  ),
  ожидание: (
    <>
      <path d="M7 3h10M7 21h10" />
      <path d="M8 3c0 5 8 5 8 9s-8 4-8 9" />
      <path d="M16 3c0 5-8 5-8 9s8 4 8 9" />
    </>
  ),
  характер: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  связь: (
    <>
      <path d="M2 8.5a15 15 0 0120 0" />
      <path d="M5.5 12a10 10 0 0113 0" />
      <path d="M9 15.5a5 5 0 016 0" />
      <path d="M12 19h.01" />
      <path d="M3 3l18 18" />
    </>
  ),
  микрофонМолчит: (
    <>
      <path d="M9 9v2a3 3 0 005 2.2" />
      <path d="M15 11V6a3 3 0 00-6-.6" />
      <path d="M5 11a7 7 0 0011.5 5.4" />
      <path d="M19 11a7 7 0 01-.6 2.8" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </>
  ),
  плохоСлышно: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 10a3 3 0 010 4" />
    </>
  ),
  собеседникМолчит: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
    </>
  ),
  письмо: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </>
  ),
  // «Как пользоваться» в меню — вопрос в круге
  справка: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 014.8.9c0 1.7-2.4 2.1-2.4 3.7" />
      <path d="M12 17.2v.1" />
    </>
  ),
};

export function Пиктограмма({
  children,
  size = 24,
  className = "",
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Плитка: пиктограмма над подписью */
export default function HintTile({
  icon,
  label,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col items-center gap-[7px] rounded-xl border border-line bg-surface px-1.5 pb-[11px] pt-3 text-center text-brand ${className}`}
    >
      <Пиктограмма>{icon}</Пиктограмма>
      <span className="text-[13px] font-medium leading-[1.25] text-ink-body">{label}</span>
    </div>
  );
}
