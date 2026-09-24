"use client";

// Разговор карточкой — телефонная форма строки ConversationRow (кадр
// «Телефон · 390 · главная»). В строке десктопа тема, тип, длительность,
// оценка и слово «Расшифровка» стоят в одну линию; на 390 px им тесно,
// поэтому карточка в два яруса: кто и когда, ниже — тип, длина и оценка.
//
// Нажимается карточка целиком — это и есть переход к расшифровке, слово
// «Расшифровка» здесь не нужно. Звезда стоит отдельной кнопкой справа,
// вне ссылки: кнопку в ссылку вкладывать нельзя.

import Link from "next/link";
import type { HomeConversation } from "@/lib/home";
import ScoreBadge from "@/app/components/ScoreBadge";
import PatientAvatar from "@/app/components/PatientAvatar";
import { formatConversationDate, formatDuration } from "@/lib/format";

interface ConversationCardProps {
  conversation: HomeConversation;
  /** Не передан — звезды нет (см. ConversationRow) */
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
}

export default function ConversationCard({
  conversation,
  onToggleFavorite,
}: ConversationCardProps) {
  const title = [conversation.patientName, conversation.topic]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-start rounded-2xl border border-line bg-surface-card">
      <Link
        href={`/transcript/${conversation.id}`}
        className={`flex min-w-0 flex-1 flex-col gap-2.5 py-3.5 pl-3.5 ${
          onToggleFavorite ? "" : "pr-3.5"
        }`}
      >
        <div className="flex items-center gap-3">
          <PatientAvatar
            name={conversation.patientName}
            className="h-10 w-10 bg-brand-soft text-sm font-semibold text-brand"
            lazy
          />
          <div className="min-w-0 flex-1">
            <div className="text-pretty text-[15px] font-semibold leading-[1.3] text-ink">
              {title || "Разговор"}
            </div>
            <div className="mt-0.5 text-[13px] text-ink-subtle">
              {formatConversationDate(conversation.startedAt)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 pl-[52px]">
          {/* Разговорам до мастера настройки тип не выдумываем — тише
              остальных, без плашки (см. ConversationRow) */}
          {conversation.trainingType ? (
            <span className="whitespace-nowrap rounded-full border border-line-soft bg-surface-bubble px-2.5 py-[3px] text-[13px] font-semibold text-ink-muted">
              {conversation.trainingType}
            </span>
          ) : (
            <span className="text-[13px] text-ink-subtle">Тип не указан</span>
          )}
          <span className="font-mono text-[13px] text-ink-muted">
            {formatDuration(conversation.durationSec)}
          </span>
          <span className="ml-auto">
            <ScoreBadge score={conversation.score} />
          </span>
        </div>
      </Link>

      {onToggleFavorite && (
        <button
          type="button"
          onClick={() => onToggleFavorite(conversation.id, !conversation.isFavorite)}
          title={conversation.isFavorite ? "Убрать из избранного" : "В избранное"}
          aria-pressed={conversation.isFavorite}
          className="ml-0.5 mr-1 mt-3 inline-flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <svg
            width="20"
            height="20"
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
    </div>
  );
}
