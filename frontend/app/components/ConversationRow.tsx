"use client";

// Строка списка разговоров: избранное, аватар пациента, тема, дата,
// длительность, оценка и переход к расшифровке.

import Link from "next/link";
import type { HomeConversation } from "@/lib/home";
import ScoreBadge from "@/app/components/ScoreBadge";
import {
  formatConversationDate,
  formatDuration,
  initials,
} from "@/lib/format";

interface ConversationRowProps {
  conversation: HomeConversation;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
}

export default function ConversationRow({
  conversation,
  onToggleFavorite,
}: ConversationRowProps) {
  const title = [conversation.patientName, conversation.topic]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-3 border-b border-line-soft px-5 py-[11px] last:border-b-0">
      <button
        type="button"
        onClick={() => onToggleFavorite(conversation.id, !conversation.isFavorite)}
        title={conversation.isFavorite ? "Убрать из избранного" : "В избранное"}
        aria-pressed={conversation.isFavorite}
        className="inline-flex shrink-0 p-0.5 leading-none"
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

      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
        {initials(conversation.patientName)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">
          {title || "Разговор"}
        </div>
        <div className="mt-px whitespace-nowrap text-xs text-ink-subtle">
          {formatConversationDate(conversation.startedAt)}
        </div>
      </div>

      <div className="shrink-0 font-mono text-[12.5px] text-ink-muted">
        {formatDuration(conversation.durationSec)}
      </div>

      <ScoreBadge score={conversation.score} />

      <Link
        href={`/transcript/${conversation.id}`}
        title="Открыть расшифровку"
        className="inline-flex shrink-0 items-center p-1 text-ink-icon transition-colors hover:text-brand-hover"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
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
