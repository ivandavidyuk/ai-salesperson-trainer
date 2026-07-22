// Переиспользуемая кнопка дизайн-системы podhod.tech.
// Варианты: primary (тиловая), secondary (белая с рамкой), danger (красная).
import type { ButtonHTMLAttributes } from "react";
import Spinner from "@/app/components/Spinner";

type Variant = "primary" | "secondary" | "danger";
type Size = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Показать спиннер и заблокировать кнопку на время запроса. */
  loading?: boolean;
}

// Классы Tailwind для каждого варианта оформления
const variantClasses: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "border border-line-strong bg-white text-ink hover:bg-surface",
  danger: "bg-danger text-white hover:bg-danger/90",
};

// Размеры: md — кнопки экранов, lg — крупная кнопка формы
const sizeClasses: Record<Size, string> = {
  md: "px-5 py-[11px] text-[15px]",
  lg: "px-5 py-[14px] text-base",
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const isBlocked = disabled || loading;

  // Во время загрузки сохраняем фирменный оттенок, при обычном disabled —
  // нейтральный серый (как в дизайн-системе)
  const blockedClasses = loading
    ? "bg-brand-muted text-brand-on-muted border-transparent"
    : "bg-disabled text-disabled-text border-transparent";

  return (
    <button
      disabled={isBlocked}
      className={`inline-flex items-center justify-center gap-2.5 rounded-input font-semibold transition-colors disabled:cursor-not-allowed ${
        sizeClasses[size]
      } ${isBlocked ? blockedClasses : variantClasses[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
