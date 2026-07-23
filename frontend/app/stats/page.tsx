"use client";

// Раздел «Статистика» — только для руководителя.
// Строка на менеджера: разговоры, активность за неделю и средняя оценка.
// «Подробнее» раскрывает прогресс по этапам, сильную сторону, точку роста
// и последние разговоры.

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/app/components/AppShell";
import ScoreBadge from "@/app/components/ScoreBadge";
import Spinner from "@/app/components/Spinner";
import TeamHistoryModal from "@/app/components/TeamHistoryModal";
import { initials, plural } from "@/lib/format";
import type { TeamMemberStats } from "@/lib/team";

export default function StatsPage() {
  const [team, setTeam] = useState<TeamMemberStats[] | null>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [historyOf, setHistoryOf] = useState<TeamMemberStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team/stats");
        if (res.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as TeamMemberStats[];
        if (!cancelled) setTeam(data);
      } catch {
        if (!cancelled) setError("Не удалось загрузить статистику");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell title="Статистика">
      <div className="mx-auto w-full max-w-[1440px] px-10 pb-9 pt-[26px]">
        {forbidden && (
          <div className="rounded-[14px] border border-line bg-surface-card px-6 py-14 text-center">
            <div className="text-[15px] font-semibold text-ink">
              Раздел доступен только руководителю
            </div>
            <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-normal text-ink-muted">
              Здесь собрана статистика по менеджерам отдела. Свои показатели
              вы найдёте на главной.
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-input border border-line-strong bg-surface-card px-5 py-[11px] text-[15px] font-semibold text-ink transition-colors hover:bg-surface"
            >
              На главную
            </Link>
          </div>
        )}

        {!forbidden && (
          <>
            <div className="mb-5">
              <h1 className="text-[21px] font-semibold tracking-[-.01em] text-ink">
                Менеджеры отдела
              </h1>
              <p className="mt-1 text-sm text-ink-muted">
                {team
                  ? `${team.length} ${plural(team.length, "менеджер", "менеджера", "менеджеров")} · оценки за всё время, динамика — неделя к неделе`
                  : "Загружаем показатели"}
              </p>
            </div>

            {!team && !error && (
              <div className="flex justify-center py-16 text-ink-muted">
                <Spinner />
              </div>
            )}

            {error && (
              <p className="py-16 text-center text-sm text-danger-text">{error}</p>
            )}

            {team?.length === 0 && (
              <div className="rounded-[14px] border border-line bg-surface-card px-6 py-14 text-center">
                <div className="text-[15px] font-semibold text-ink">
                  Менеджеров пока нет
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3.5">
              {team?.map((member) => (
                <ManagerRow
                  key={member.id}
                  member={member}
                  expanded={Boolean(expanded[member.id])}
                  onToggle={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [member.id]: !prev[member.id],
                    }))
                  }
                  onOpenHistory={() => setHistoryOf(member)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {historyOf && (
        <TeamHistoryModal
          managerId={historyOf.id}
          managerName={historyOf.name}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </AppShell>
  );
}

interface ManagerRowProps {
  member: TeamMemberStats;
  expanded: boolean;
  onToggle: () => void;
  onOpenHistory: () => void;
}

function ManagerRow({
  member,
  expanded,
  onToggle,
  onOpenHistory,
}: ManagerRowProps) {
  // Раскрывать нечего, пока менеджер не провёл ни одного разговора
  const hasData = member.total > 0;

  return (
    <div className="rounded-[14px] border border-line bg-surface-card px-[22px] py-5">
      <div className="flex items-center gap-3.5">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-[17px] font-semibold text-brand">
          {member.avatarUpdatedAt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/users/${member.id}/avatar?v=${encodeURIComponent(member.avatarUpdatedAt)}`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initials(member.name)
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[16.5px] font-semibold text-ink">{member.name}</div>
          <div className="mt-px text-[13px] text-ink-subtle">{member.jobTitle}</div>
        </div>

        <div className="flex items-center gap-[22px]">
          <Metric value={member.total} label="разговоров" />
          <Metric value={member.week} label="за неделю" />

          <div className="text-center">
            <ScoreBadge score={member.avgScore} />
            <div className="mt-1 text-[11.5px] text-ink-subtle">ср. оценка</div>
          </div>

          <button
            type="button"
            onClick={onToggle}
            disabled={!hasData}
            title={hasData ? undefined : "Разговоров пока нет"}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-input border px-[18px] py-[11px] text-sm font-semibold transition-colors ${
              hasData
                ? "border-line-accent bg-surface-accent text-brand-hover hover:bg-[#DCEDE9]"
                : "cursor-not-allowed border-line bg-surface text-ink-placeholder"
            }`}
          >
            {expanded ? "Свернуть" : "Подробнее"}
            <span
              className="inline-flex transition-transform"
              style={{ transform: expanded ? "rotate(180deg)" : undefined }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {expanded && hasData && (
        <>
          <div className="my-5 h-px bg-line-soft" />

          <div className="flex flex-wrap items-stretch gap-[26px]">
            <div className="min-w-[280px] flex-[1.4]">
              <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                Прогресс по этапам
              </div>
              <div className="flex flex-col gap-[11px]">
                {member.stages.map((stage) => (
                  <div key={stage.key}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-ink-body">{stage.label}</span>
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
                        // Шкала 0–10 переводится в проценты напрямую
                        style={{ width: `${((stage.value ?? 0) / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-w-[240px] flex-1 flex-col gap-3.5">
              {member.strength && (
                <div>
                  <span className="rounded-full bg-good-surface px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.08em] text-good">
                    Сильная сторона
                  </span>
                  <p className="mt-1.5 text-pretty text-[13.5px] leading-snug text-ink-body">
                    {member.strength}
                  </p>
                </div>
              )}
              {member.growthPoint && (
                <div>
                  <span className="rounded-full bg-warn-surface px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.08em] text-warn">
                    Точка роста
                  </span>
                  <p className="mt-1.5 text-pretty text-[13.5px] leading-snug text-ink-body">
                    {member.growthPoint}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-[18px]">
            <div className="mb-2.5 flex items-center gap-5">
              <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                Последние разговоры
              </div>
              <button
                type="button"
                onClick={onOpenHistory}
                className="ml-auto px-1 py-0.5 text-[12.5px] font-semibold text-brand transition-colors hover:text-brand-hover"
              >
                Все →
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {member.recent.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/transcript/${conversation.id}`}
                  className="flex items-center gap-2.5 rounded-[10px] border border-line-soft bg-surface px-3 py-2 transition-colors hover:bg-surface-bubble"
                >
                  <span className="text-[13px] text-ink-body">
                    {conversation.topic || "Разговор"}
                  </span>
                  <ScoreBadge score={conversation.score} />
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    className="text-ink-icon"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="font-mono text-[22px] text-ink">{value || "—"}</div>
      <div className="mt-px text-[11.5px] text-ink-subtle">{label}</div>
    </div>
  );
}

// Изменение к прошлой неделе: рост зелёный, падение красное.
// Ноль и отсутствие данных не показываем — шума больше, чем смысла.
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
