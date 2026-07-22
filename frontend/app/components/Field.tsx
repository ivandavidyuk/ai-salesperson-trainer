// Поле ввода с подписью. Состояния из дизайн-системы:
//   обычное · фокус (тиловая рамка + мягкое кольцо) · ошибка (красное кольцо)
//   · disabled (приглушённая подложка и подпись).

import { useId, type InputHTMLAttributes } from "react";

// Нативный size у <input> — это число (ширина в символах), мы им не
// пользуемся. Исключаем его, чтобы занять имя под масштаб, как у Button.
interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  /** Подсветить поле как ошибочное. */
  invalid?: boolean;
  /** Масштаб: md — внутри приложения, lg — экран входа. */
  size?: "md" | "lg";
}

// Размеры из макетов
const SIZES = {
  md: {
    label: "text-[13px]",
    input: "mt-[7px] rounded-input px-[14px] py-[13px] text-[15px]",
  },
  lg: {
    label: "text-[13.5px]",
    input: "mt-2 rounded-input-lg px-4 py-[15px] text-base",
  },
} as const;

export default function Field({
  label,
  invalid = false,
  size = "md",
  disabled,
  className = "",
  ...props
}: FieldProps) {
  const id = useId();
  const scale = SIZES[size];

  // Рамка/кольцо: ошибка важнее фокуса, поэтому проверяем её первой.
  // В макете акцентная рамка (ошибка и фокус) толще обычной — 1.5px против 1px.
  // Префикс length: обязателен — без него Tailwind не понимает, ширина это
  // или цвет, и класс border-[1.5px] просто не генерируется.
  const stateClasses = invalid
    ? "border-[length:1.5px] border-danger ring-[3px] ring-danger-surface"
    : "border-line-strong focus:border-[length:1.5px] focus:border-brand focus:ring-[3px] focus:ring-brand-soft";

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={`block font-medium ${scale.label} ${
          disabled ? "text-ink-subtle" : "text-ink-label"
        }`}
      >
        {label}
      </label>
      <input
        id={id}
        disabled={disabled}
        className={`w-full border bg-white text-ink outline-none ring-offset-0 transition placeholder:text-ink-placeholder disabled:border-line disabled:bg-surface disabled:text-ink-placeholder ${scale.input} ${stateClasses}`}
        {...props}
      />
    </div>
  );
}
