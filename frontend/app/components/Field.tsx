// Поле ввода с подписью. Состояния из дизайн-системы:
//   обычное · фокус (тиловая рамка + мягкое кольцо) · ошибка (красное кольцо)
//   · disabled (приглушённая подложка и подпись).

import { useId, type InputHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Подсветить поле как ошибочное. */
  invalid?: boolean;
}

export default function Field({
  label,
  invalid = false,
  disabled,
  className = "",
  ...props
}: FieldProps) {
  const id = useId();

  // Рамка/кольцо: ошибка важнее фокуса, поэтому проверяем её первой.
  // В макете акцентная рамка (ошибка и фокус) толще обычной — 1.5px против 1px.
  const stateClasses = invalid
    ? "border-[1.5px] border-danger ring-[3px] ring-danger-surface"
    : "border-line-strong focus:border-[1.5px] focus:border-brand focus:ring-[3px] focus:ring-brand-soft";

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={`block text-[13px] font-medium ${
          disabled ? "text-ink-subtle" : "text-ink-label"
        }`}
      >
        {label}
      </label>
      <input
        id={id}
        disabled={disabled}
        className={`mt-[7px] w-full rounded-input border bg-white px-[14px] py-[13px] text-[15px] text-ink outline-none ring-offset-0 transition placeholder:text-ink-placeholder disabled:border-line disabled:bg-surface disabled:text-ink-placeholder ${stateClasses}`}
        {...props}
      />
    </div>
  );
}
