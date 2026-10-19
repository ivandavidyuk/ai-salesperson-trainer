"use client";

// Оглавление справки на компьютере: стоит слева и подсвечивает раздел,
// который сейчас на экране. Уже 1280 px его нет — там шаги и так идут
// один за другим, а боковой колонке негде встать.

import { useEffect, useState } from "react";

// Раздел считается текущим, когда его верх поднялся выше этой линии
// от верха прокручиваемой области — чуть ниже отступа над первой карточкой
const ЛИНИЯ = 120;

export default function HelpToc({ items }: { items: { id: string; label: string }[] }) {
  const [активный, setАктивный] = useState(items[0]?.id ?? "");

  useEffect(() => {
    // Прокручивается не окно, а <main> оболочки
    const корень = document.querySelector("main");
    if (!корень) return;
    function пересчитать() {
      if (!корень) return;
      const верх = корень.getBoundingClientRect().top;
      // Докрутили до конца — последние разделы короткие и до линии
      // не доберутся. Тогда линия опускается до середины экрана: так
      // подсвечивается раздел, который человек видит, а не всегда последний
      // (на высоком мониторе клик по «Смотрите разбор» иначе подсвечивал
      // «Если что-то пошло не так»)
      const вКонце = корень.scrollTop + корень.clientHeight >= корень.scrollHeight - 4;
      const линия = вКонце ? Math.max(ЛИНИЯ, корень.clientHeight / 2) : ЛИНИЯ;
      let текущий = items[0]?.id ?? "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top - верх <= линия) текущий = item.id;
      }
      setАктивный(текущий);
    }
    пересчитать();
    корень.addEventListener("scroll", пересчитать, { passive: true });
    return () => корень.removeEventListener("scroll", пересчитать);
  }, [items]);

  return (
    <nav className="sticky top-6 flex flex-col gap-0.5 max-xl:hidden" aria-label="Разделы">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`flex min-h-11 items-center rounded-[10px] px-3 text-[15px] transition-colors ${
            item.id === активный
              ? "bg-brand-soft font-semibold text-brand-hover"
              : "font-medium text-ink-label hover:bg-surface-bubble"
          }`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
