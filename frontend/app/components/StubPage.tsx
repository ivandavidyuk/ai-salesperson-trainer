// Заглушка ещё не реализованного раздела.
// Показывает ту же оболочку, что и рабочие экраны, чтобы навигация
// ощущалась цельной, и честно сообщает, что раздел в работе.

import Link from "next/link";
import AppShell from "@/app/components/AppShell";

interface StubPageProps {
  title: string;
  description: string;
}

export default function StubPage({ title, description }: StubPageProps) {
  return (
    <AppShell title={title}>
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-7 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 8v5" />
            <circle cx="12" cy="16.5" r=".6" fill="currentColor" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>

        <h1 className="mt-4 text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 max-w-[440px] text-[13.5px] leading-normal text-ink-muted">
          {description}
        </p>

        <Link
          href="/"
          className="mt-6 rounded-input border border-line-strong bg-surface-card px-5 py-[11px] text-[15px] font-semibold text-ink transition-colors hover:bg-surface"
        >
          Вернуться на главную
        </Link>
      </div>
    </AppShell>
  );
}
