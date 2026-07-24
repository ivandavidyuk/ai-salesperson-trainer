"use client";

// Подробная статистика одного менеджера — модалка со страницы «Статистика»
// у руководителя. Открывается и с карточки подиума, и из строки «Остальные».
//
// Заменила прежнюю TeamHistoryModal: по макету вся детализация собрана
// в одном окне — плитки, прогресс по этапам, выводы и полная история,
// а не раскрытая карточка плюс отдельное окно со списком.

import { useEffect, useState } from "react";
import Link from "next/link";
import Loader from "@/app/components/Loader";
import ScoreBadge from "@/app/components/ScoreBadge";
import { formatConversationDate, formatDuration, initials } from "@/lib/format";
import { SCORE_TEXT_CLASS, scoreTone } from "@/lib/score";
import type { TeamMemberStats } from "@/lib/team";
import { PLACE_BANNER, PLACE_PILL, placeLabel } from "@/lib/podium";

interface HistorySession {
  id: string;
  topic: string | null;
  startedAt: string;
  durationSec: number | null;
  score: number | null;
}

interface TeamStatsModalProps {
  manager: TeamMemberStats;
  /** Место в отделе — от него зависят цвет шапки и плашка */
  place: number;
  onClose: () => void;
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line-soft bg-surface px-4 py-3.5 text-center">
      <div className="font-mono text-[22px] text-ink">{value}</div>
      <div className="mt-0.5 text-xs text-ink-subtle">{label}</div>
    </div>
  );
}

function Delta({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={`rounded-full px-[7px] py-0.5 text-[11px] font-semibold ${
        up ? "bg-good-surface text-good" : "bg-danger-soft text-danger-strong"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

export default function TeamStatsModal({
  manager,
  place,
  onClose,
}: TeamStatsModalProps) {
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/team/${manager.id}/sessions`);
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
  }, [manager.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const avgClass =
    manager.avgScore === null
      ? "text-ink-subtle"
      : SCORE_TEXT_CLASS[scoreTone(manager.avgScore)];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,26,24,.5)] p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-[760px] max-w-full flex-col overflow-hidden rounded-[18px] bg-surface-card shadow-[0_44px_110px_-30px_rgba(12,26,24,.75)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={`flex shrink-0 items-center gap-4 border-b border-line px-[26px] py-6 ${PLACE_BANNER[place] ?? "bg-surface-accent"}`}
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-[length:3px] border-surface-card bg-brand-soft text-[20px] font-semibold text-brand shadow-[0_4px_14px_-6px_rgba(20,40,38,.5)]">
            {manager.avatarUpdatedAt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/users/${manager.id}/avatar?v=${encodeURIComponent(manager.avatarUpdatedAt)}`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initials(manager.name)
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <div className="text-xl font-semibold text-ink">{manager.name}</div>
              <span className={PLACE_PILL[place] ?? PLACE_PILL.other}>
                {placeLabel(place)}
              </span>
            </div>
            <div className="mt-0.5 text-[13.5px] text-ink-muted">
              {manager.jobTitle}
            </div>
          </div>

          <div className="shrink-0 text-center">
            <div className={`font-mono text-[26px] font-medium leading-none ${avgClass}`}>
              {manager.avgScore ?? "—"}
            </div>
            <div className="mt-1 text-[11px] text-ink-subtle">ср. оценка</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-card text-[17px] leading-none text-ink-muted transition-colors hover:bg-surface-bubble"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[26px] pb-7 pt-6">
          <div className="mb-6 flex gap-3">
            <Tile value={String(manager.total)} label="разговоров всего" />
            <Tile value={String(manager.week)} label="за неделю" />
            <Tile
              value={manager.bestScore === null ? "—" : String(manager.bestScore)}
              label="лучшая оценка"
            />
          </div>

          <div className="mb-6 flex flex-wrap items-stretch gap-[26px]">
            <div className="min-w-[300px] flex-[1.4]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                Прогресс по этапам
              </div>
              <div className="flex flex-col gap-3">
                {manager.stages.map((stage) => (
                  <div key={stage.key}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-ink-body">
                        {stage.label}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-[13px] text-ink">
                          {stage.value ?? "—"}
                        </span>
                        <Delta delta={stage.delta} />
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${((stage.value ?? 0) / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-w-[250px] flex-1 flex-col gap-4">
              {manager.strength && (
                <div>
                  <span className="rounded-full bg-good-surface px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.08em] text-good">
                    Сильная сторона
                  </span>
                  <p className="mt-2 text-pretty text-[13.5px] leading-snug text-ink-body">
                    {manager.strength}
                  </p>
                </div>
              )}
              {manager.growthPoint && (
                <div>
                  <span className="rounded-full bg-warn-surface px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.08em] text-warn">
                    Точка роста
                  </span>
                  <p className="mt-2 text-pretty text-[13.5px] leading-snug text-ink-body">
                    {manager.growthPoint}
                  </p>
                </div>
              )}
              {!manager.strength && !manager.growthPoint && (
                <p className="text-[13.5px] leading-normal text-ink-muted">
                  Выводы появятся после разбора разговоров.
                </p>
              )}
            </div>
          </div>

          <div className="mb-2.5 flex items-center gap-3">
            <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
              Все разговоры
            </div>
            <div className="h-px flex-1 bg-line-soft" />
          </div>

          {!sessions && !error && (
            <div className="py-10">
              <Loader />
            </div>
          )}

          {error && (
            <p className="py-8 text-center text-sm text-danger-text">{error}</p>
          )}

          {sessions?.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-muted">
              Разговоров пока нет.
            </p>
          )}

          <div className="flex flex-col">
            {sessions?.map((session) => (
              <Link
                key={session.id}
                href={`/transcript/${session.id}`}
                className="flex items-center gap-3.5 rounded-[10px] px-3.5 py-3 transition-colors hover:bg-surface-bubble"
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
                  strokeLinejoin="round"
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
    </div>
  );
}
