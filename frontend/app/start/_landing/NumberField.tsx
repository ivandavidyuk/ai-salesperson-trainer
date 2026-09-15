"use client";

// Поле для денег: разряды разделяются прямо при вводе, курсор не прыгает.
// Набираешь «15000000» — в поле стоит «15 000 000».

import { useRef, useState, type ChangeEvent } from "react";

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  className?: string;
  tone?: "brand" | "good";
  maxDigits?: number;
  /** Разовая подсветка, чтобы было видно, что это поле ввода */
  highlight?: boolean;
}

export default function NumberField({
  value,
  onChange,
  label,
  className = "",
  tone = "brand",
  maxDigits = 9,
  highlight = false,
}: NumberFieldProps) {
  const [text, setText] = useState(group(String(value)));
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const caret = event.target.selectionStart ?? raw.length;
    const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length;
    const digits = raw.replace(/\D/g, "").slice(0, maxDigits).replace(/^0+(?=\d)/, "");
    const grouped = group(digits);
    setText(grouped);
    onChange(digits ? parseInt(digits, 10) : 0);

    // Курсор ставится после того же числа цифр, что было до него
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      let seen = 0;
      let position = 0;
      for (let i = 0; i < grouped.length && seen < digitsBeforeCaret; i += 1) {
        if (/\d/.test(grouped[i])) seen += 1;
        position = i + 1;
      }
      input.setSelectionRange(position, position);
    });
  };

  const focus =
    tone === "good"
      ? "focus:border-good focus:ring-good/20"
      : "focus:border-brand focus:ring-brand/20";
  const glow = highlight
    ? tone === "good"
      ? "border-good ring-4 ring-good/20"
      : "border-brand ring-4 ring-brand/20"
    : "border-line-strong";

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={text}
        onChange={handleChange}
        className={`h-[50px] w-full rounded-[11px] border bg-surface-card pl-3.5 pr-[34px] font-mono text-[20px] font-medium text-ink outline-none transition-[box-shadow,border-color] duration-300 focus:ring-4 focus:ring-offset-0 ${glow} ${focus}`}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[20px] font-medium text-ink-subtle">
        ₽
      </span>
    </div>
  );
}
