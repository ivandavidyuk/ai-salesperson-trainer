"use client";

// Раздел «Достижения»: витрина игровых бейджей за прогресс в тренировках.
// Полученные подсвечены, закрытые приглушены с замком; сверху сводка
// с прогресс-баром и фильтр.
//
// Механизма выдачи пока нет — полученные проставляет сид демо-аккаунта.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import AppShell from "@/app/components/AppShell";
import Spinner from "@/app/components/Spinner";
import { plural } from "@/lib/format";

type Tone = "skill" | "gold" | "fun";

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  tone: Tone;
  /** null — достижение ещё не получено */
  unlockedAt: string | null;
}

interface AchievementsData {
  total: number;
  unlocked: number;
  items: Achievement[];
}

type Filter = "all" | "unlocked" | "locked";

// Оформление медальона по тону достижения
const TONE_CLASSES: Record<Tone, { medal: string; status: string }> = {
  skill: { medal: "bg-brand-soft text-brand", status: "text-brand" },
  gold: { medal: "bg-warn-surface text-warn", status: "text-warn" },
  fun: { medal: "bg-merry-surface text-merry", status: "text-merry" },
};

// Иконки из макета. Ключ — поле icon в базе; для незнакомого ключа берётся
// запасная иконка, иначе новое достижение уронило бы страницу.
const ICONS: Record<string, ReactNode> = {
  contact: (<><path d="M8 12l2 2 5-5" /><circle cx="12" cy="12" r="9" /></>),
  check: <path d="M20 6L9 17l-5-5" />,
  triple: (<><path d="M4 8l3 3 4-5" /><path d="M4 15l3 3 4-5" /><path d="M14 9h6" /><path d="M14 16h6" /></>),
  flame: (<><path d="M12 3c1 3 4 4 4 8a4 4 0 01-8 0c0-1.5.6-2.3 1.2-3C10 9 12 7 12 3z" /><path d="M8 12a5.5 5.5 0 108 5" /></>),
  script: (<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h3" /></>),
  bolt: <path d="M13 2L4.5 13H11l-1 9 8.5-11H12z" />,
  shield: (<><path d="M12 3l7 3v5c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V6z" /><path d="M9.2 12l1.9 1.9 3.7-3.8" /></>),
  infinity: <path d="M7 9a3 3 0 100 6c2 0 3-3 5-3s3 3 5 3a3 3 0 100-6c-2 0-3 3-5 3s-3-3-5-3z" />,
  skull: (<><path d="M12 3a7 7 0 00-4 12.7V18a1 1 0 001 1h6a1 1 0 001-1v-2.3A7 7 0 0012 3z" /><circle cx="9.5" cy="12" r="1.2" /><circle cx="14.5" cy="12" r="1.2" /><path d="M10 21v-2" /><path d="M14 21v-2" /></>),
  crown: <path d="M4 8l3.5 4L12 6l4.5 6L20 8l-1.5 11h-13z" />,
  search: (<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>),
  shieldx: (<><path d="M12 3l7 3v5c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V6z" /><path d="M12 8v4" /><path d="M12 15h.01" /></>),
  target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>),
  lunch: (<><path d="M6 3v7a2 2 0 002 2 2 2 0 002-2V3" /><path d="M8 3v18" /><path d="M16 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4v9" /></>),
  money: (<><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M7 9v6" /><path d="M17 9v6" /></>),
  coin: (<><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2A3 3 0 0012 8c-1.7 0-3 .9-3 2.2 0 2.8 6 1.4 6 4 0 1.3-1.3 2.2-3 2.2a3 3 0 01-2.5-1.2" /><path d="M12 6.5v11" /></>),
  trophy: (<><path d="M7 4h10v4a5 5 0 01-10 0z" /><path d="M7 6H4v1a3 3 0 003 3" /><path d="M17 6h3v1a3 3 0 01-3 3" /><path d="M9 20h6" /><path d="M12 13v7" /></>),
  chat: (<><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8" /><path d="M8 12h5" /></>),
  mute: (<><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M22 9l-6 6" /><path d="M16 9l6 6" /></>),
  door: (<><path d="M14 3H6v18h8" /><path d="M14 3l4 2v14l-4 2z" /><path d="M11 12h.01" /></>),
  angry: (<><circle cx="12" cy="12" r="9" /><path d="M8.5 15c1-1 5-1 7 0" /><path d="M8 9.5l2 .8" /><path d="M16 9.5l-2 .8" /></>),
  parrot: (<><path d="M17 3a5 5 0 00-5 5v2l-6 6 3 3 3-3h2a3 3 0 003-3" /><path d="M17 8h.01" /></>),
  revive: (<><path d="M4 12a8 8 0 018-8 8 8 0 016 2.7L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 01-8 8 8 8 0 01-6-2.7L4 15" /><path d="M4 20v-5h5" /></>),
  pen: (<><path d="M15 4l5 5L8 21l-5 1 1-5z" /><path d="M13 6l5 5" /></>),
  tag: (<><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8" cy="8" r="1.4" /></>),
  shark: <path d="M3 17c4 0 5-3 8-3 4 0 6-9 10-9-1 4-2 6-2 6s2 1 2 4c-3 0-4-1-4-1s-3 3-8 3c-2 0-4 2-6 2z" />,
};

const FALLBACK_ICON = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>
);

function Icon({ children, size = 26 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function AchievementsPage() {
  const [data, setData] = useState<AchievementsData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/achievements");
        if (!res.ok) throw new Error("request failed");
        const payload = (await res.json()) as AchievementsData;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Не удалось загрузить достижения");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lockedCount = data ? data.total - data.unlocked : 0;
  const percent = data && data.total > 0
    ? Math.round((data.unlocked / data.total) * 100)
    : 0;

  const visible = useMemo(() => {
    if (!data) return [];
    if (filter === "unlocked") return data.items.filter((i) => i.unlockedAt);
    if (filter === "locked") return data.items.filter((i) => !i.unlockedAt);
    return data.items;
  }, [data, filter]);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "Все", count: data?.total ?? 0 },
    { key: "unlocked", label: "Полученные", count: data?.unlocked ?? 0 },
    { key: "locked", label: "Закрытые", count: lockedCount },
  ];

  return (
    <AppShell title="Достижения">
      <div className="mx-auto w-full max-w-[1440px] px-10 pb-11 pt-[26px]">
        {!data && !error && (
          <div className="flex justify-center py-16 text-ink-muted">
            <Spinner />
          </div>
        )}

        {error && (
          <p className="py-16 text-center text-sm text-danger-text">{error}</p>
        )}

        {data && (
          <>
            {/* Сводка и фильтр */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-5">
              <div className="flex min-w-[280px] flex-1 items-center gap-5">
                <span className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-medal to-gold-medal-deep text-white shadow-[0_10px_24px_-12px_rgba(154,107,8,.7)]">
                  <Icon size={30}>{ICONS.trophy}</Icon>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[26px] font-bold text-ink">
                      {data.unlocked}
                    </span>
                    <span className="text-[15px] text-ink-subtle">
                      из {data.total}{" "}
                      {plural(data.total, "достижения", "достижений", "достижений")}{" "}
                      получено
                    </span>
                  </div>
                  <div className="mt-2 h-2 max-w-[420px] overflow-hidden rounded-full bg-[#E7ECEB]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand to-[#12A08F]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {filters.map((item) => {
                  const active = filter === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setFilter(item.key)}
                      className={`inline-flex items-center whitespace-nowrap rounded-full border px-[15px] py-2 text-[13px] font-semibold transition-colors ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-line-strong bg-surface-card text-ink-muted hover:border-brand-soft"
                      }`}
                    >
                      {item.label} · {item.count}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Сетка бейджей */}
            <div className="flex flex-wrap gap-[14px]">
              {visible.map((item) => (
                <AchievementCard key={item.id} achievement={item} />
              ))}

              {visible.length === 0 && (
                <div className="w-full px-5 py-14 text-center">
                  <div className="text-base font-semibold text-ink-muted">
                    {filter === "unlocked"
                      ? "Пока ничего не получено"
                      : "Все достижения получены"}
                  </div>
                  <div className="mt-1.5 text-sm text-ink-subtle">
                    {filter === "unlocked"
                      ? "Проведите первую тренировку — бейджи начнут открываться."
                      : "Впечатляет: закрытых достижений не осталось."}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const unlocked = achievement.unlockedAt !== null;
  const tone = TONE_CLASSES[achievement.tone] ?? TONE_CLASSES.skill;
  const icon = ICONS[achievement.icon] ?? FALLBACK_ICON;

  return (
    // Пять колонок при gap-[14px]: (100% − 4 × 14px) / 5
    <div
      className={`flex w-[calc((100%-56px)/5)] min-w-[150px] flex-col rounded-[14px] border p-[18px] ${
        unlocked
          ? "border-line bg-surface-card"
          : "border-locked-border bg-locked-surface"
      }`}
    >
      <div
        className={`relative flex h-[54px] w-[54px] items-center justify-center rounded-[15px] ${
          unlocked ? tone.medal : "bg-locked-medal text-locked-icon"
        }`}
      >
        <Icon>{icon}</Icon>

        {!unlocked && (
          <span className="absolute -bottom-[3px] -right-[3px] flex h-5 w-5 items-center justify-center rounded-full border-2 border-locked-surface bg-ink-subtle">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </svg>
          </span>
        )}
      </div>

      <div
        className={`mt-3 text-pretty text-[14.5px] font-semibold leading-tight ${
          unlocked ? "text-ink" : "text-ink-subtle"
        }`}
      >
        {achievement.name}
      </div>
      {/* flex-1 держит строку статуса у нижнего края при разной длине описаний */}
      <div
        className={`mt-1 flex-1 text-pretty text-[12.5px] leading-normal ${
          unlocked ? "text-ink-muted" : "text-locked-text"
        }`}
      >
        {achievement.description}
      </div>

      <div
        className={`mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold ${
          unlocked ? tone.status : "text-locked-icon"
        }`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {unlocked ? "Получено" : "Закрыто"}
      </div>
    </div>
  );
}
