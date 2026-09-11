"use client";

// Строка списка разговоров: избранное, аватар пациента, тема, дата,
// длительность, оценка и переход к расшифровке.
//
// Переход назван словом, а не значком. Значок «›» у края строки не находили:
// человек со стороны смотрел прямо на него и спрашивал, как открыть
// расшифровку. Слово «Расшифровка» называет, куда ведёт строка, и шесть
// строк подряд читаются колонкой ссылок, а не шестью кнопками.
//
// Кликабельна строка целиком, но ссылка растянута псевдоэлементом, а не
// обёрнута вокруг: внутри строки живёт кнопка «в избранное», а кнопку
// в ссылку вкладывать нельзя. Поэтому звезда поднята над растяжкой
// и нажимается сама по себе.

import Link from "next/link";
import type { HomeConversation } from "@/lib/home";
import ScoreBadge from "@/app/components/ScoreBadge";
import PatientAvatar from "@/app/components/PatientAvatar";
import { formatConversationDate, formatDuration } from "@/lib/format";

interface ConversationRowProps {
  conversation: HomeConversation;
  /**
   * Не передан — звезды нет. Так строка выглядит у руководителя: избранное
   * это личная пометка менеджера, ставить её за него нечего, а чужая звезда
   * ничего руководителю не говорит.
   */
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
}

export default function ConversationRow({
  conversation,
  onToggleFavorite,
}: ConversationRowProps) {
  const title = [conversation.patientName, conversation.topic]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="group relative flex items-center gap-3 border-b border-line-soft px-5 py-[11px] transition-colors last:border-b-0 hover:bg-surface">
      {onToggleFavorite && (
      <button
        type="button"
        onClick={() => onToggleFavorite(conversation.id, !conversation.isFavorite)}
        title={conversation.isFavorite ? "Убрать из избранного" : "В избранное"}
        aria-pressed={conversation.isFavorite}
        className="relative z-10 inline-flex shrink-0 p-0.5 leading-none"
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill={conversation.isFavorite ? "currentColor" : "none"}
          stroke={conversation.isFavorite ? "none" : "currentColor"}
          strokeWidth="1.7"
          className={conversation.isFavorite ? "text-star-on" : "text-star-off"}
          aria-hidden="true"
        >
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      </button>
      )}

      <PatientAvatar
        name={conversation.patientName}
        className="h-10 w-10 bg-brand-soft text-sm font-semibold text-brand"
        lazy
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">
          {title || "Разговор"}
        </div>
        <div className="mt-px whitespace-nowrap text-xs text-ink-subtle">
          {formatConversationDate(conversation.startedAt)}
        </div>
      </div>

      <div className="shrink-0 font-mono text-[14px] text-ink-muted">
        {formatDuration(conversation.durationSec)}
      </div>

      <ScoreBadge score={conversation.score} />

      <Link
        href={`/transcript/${conversation.id}`}
        title="Открыть расшифровку"
        // after:inset-0 растягивает ссылку на всю строку: кликом считается
        // любое место, а само слово остаётся якорем для глаза
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap py-1 text-[12.5px] font-medium text-brand transition-colors after:absolute after:inset-0 group-hover:text-brand-hover group-hover:underline group-hover:[text-underline-offset:3px]"
      >
        Расшифровка
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}
