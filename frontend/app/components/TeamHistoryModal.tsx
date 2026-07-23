"use client";

// Все разговоры одного менеджера — модалка со страницы статистики.
// Открывается по «Все →» в раскрытой карточке.

import { useEffect, useState } from "react";
import Link from "next/link";
import ScoreBadge from "@/app/components/ScoreBadge";
import Spinner from "@/app/components/Spinner";
import { formatConversationDate, formatDuration, initials } from "@/lib/format";

interface HistorySession {
  id: string;
  topic: string | null;
  startedAt: string;
  durationSec: number | null;
  score: number | null;
}

interface TeamHistoryModalProps {
  managerId: string;
  managerName: string;
  onClose: () => void;
}

export default function TeamHistoryModal({
  managerId,
  managerName,
  onClose,
}: TeamHistoryModalProps) {
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/team/${managerId}/sessions`);
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as { sessions: HistorySession[] };
        if (!cancelled) setSessions(data.sessions);
      } catch {
        if (!cancelled) setError("Не удалось загрузить разговоры");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [managerId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,26,24,.5)] p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Разговоры: ${managerName}`}
    >
      <div
        className="flex max-h-full w-[540px] max-w-full flex-col overflow-hidden rounded-2xl bg-surface-card shadow-[0_40px_100px_-30px_rgba(12,26,24,.75)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line-soft px-6 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[15px] font-semibold text-brand">
            {initials(managerName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold text-ink">{managerName}</div>
            <div className="mt-0.5 text-[13px] text-ink-subtle">Все разговоры</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-bubble text-base leading-none text-ink-muted transition-colors hover:bg-line"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!sessions && !error && (
            <div className="flex justify-center py-12 text-ink-muted">
              <Spinner />
            </div>
          )}

          {error && (
            <p className="py-12 text-center text-sm text-danger-text">{error}</p>
          )}

          {sessions?.length === 0 && (
            <p className="py-12 text-center text-sm text-ink-muted">
              Разговоров пока нет.
            </p>
          )}

          {sessions?.map((session) => (
            <Link
              key={session.id}
              href={`/transcript/${session.id}`}
              className="flex items-center gap-3.5 rounded-[10px] px-4 py-3 transition-colors hover:bg-surface-bubble"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">
                  {session.topic || "Разговор"}
                </div>
                <div className="mt-px text-xs text-ink-subtle">
                  {formatConversationDate(session.startedAt)}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[12.5px] text-ink-muted">
                {formatDuration(session.durationSec)}
              </span>
              <ScoreBadge score={session.score} />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                className="shrink-0 text-ink-icon"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
