// Блок сообщения об ошибке (например, неверный логин/пароль).
// Оформление из дизайн-системы: мягкая красная подложка, рамка и маркер «!».

import type { ReactNode } from "react";

interface AlertProps {
  children: ReactNode;
  className?: string;
}

export default function Alert({ children, className = "" }: AlertProps) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-input border border-danger-border bg-danger-surface px-3.5 py-3 ${className}`}
    >
      <span aria-hidden="true" className="shrink-0 font-bold text-danger">
        !
      </span>
      <div className="text-[13.5px] leading-snug text-danger-text">
        {children}
      </div>
    </div>
  );
}
