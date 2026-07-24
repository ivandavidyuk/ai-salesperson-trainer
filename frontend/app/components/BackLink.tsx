"use client";

// Ссылка «Назад» — возврат на предыдущий экран, а не на главную.
//
// Раньше здесь стоял жёсткий переход на «/», и это ломалось на первом же
// неочевидном маршруте: руководитель открывал расшифровку подчинённого со
// «Статистики», а «Назад» уводило его на главную. Теперь это настоящий
// возврат по истории.
//
// Кнопка, а не ссылка: у неё нет постоянного адреса — она зависит от того,
// откуда пришли. Логотип рядом остаётся ссылкой на главную, и теперь эти
// два элемента наконец делают разное.

import { useRouter } from "next/navigation";

interface BackLinkProps {
  /** Куда идти, если возвращаться некуда (прямой заход по ссылке). */
  fallback?: string;
  className?: string;
}

export default function BackLink({
  fallback = "/",
  className = "",
}: BackLinkProps) {
  const router = useRouter();

  function handleBack() {
    // history.length === 1 бывает при заходе по прямой ссылке в новой
    // вкладке: возвращаться некуда, и router.back() просто ничего не сделал бы
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className={`text-sm text-ink-muted transition-colors hover:text-brand-hover ${className}`}
    >
      ← Назад
    </button>
  );
}
