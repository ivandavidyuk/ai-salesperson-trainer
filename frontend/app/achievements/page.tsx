"use client";

// Раздел «Достижения»: витрина игровых бейджей за прогресс в тренировках.
// Полученные подсвечены, закрытые приглушены с замком; сверху сводка
// с прогресс-баром и фильтр.

import { useEffect, useMemo, useState } from "react";
import AppShell, {
  ACHIEVEMENTS_CHANGED_EVENT,
} from "@/app/components/AppShell";
import Loader from "@/app/components/Loader";
import { plural } from "@/lib/format";
import {
  Icon,
  TONE_CLASSES,
  iconFor,
  type Tone,
} from "@/app/components/achievementVisuals";

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

  // Полка — то место, где новость дочитывают до конца, поэтому счётчик
  // в меню гасит именно заход сюда, а не таймер и не закрытие плашки.
  // Событием сообщаем оболочке, чтобы цифра пропала сразу, а не на
  // следующем переходе
  useEffect(() => {
    void fetch("/api/achievements/seen", { method: "POST" })
      .then(() => {
        window.dispatchEvent(new Event(ACHIEVEMENTS_CHANGED_EVENT));
      })
      .catch(() => {
        // молча: счётчик погаснет при следующем заходе
      });
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
      <div className="mx-auto w-full max-w-[1760px] px-10 pb-11 pt-[26px]">
        {!data && !error && (
          <div className="flex justify-center py-16">
            <Loader />
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
                  <Icon size={30}>{iconFor("trophy")}</Icon>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[27px] font-bold text-ink">
                      {data.unlocked}
                    </span>
                    <span className="text-[16.5px] text-ink-subtle">
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
                      className={`inline-flex items-center whitespace-nowrap rounded-full border px-[15px] py-2 text-[14.5px] font-semibold transition-colors ${
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
  const icon = iconFor(achievement.icon);

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
        className={`mt-3 text-pretty text-[16px] font-semibold leading-tight ${
          unlocked ? "text-ink" : "text-ink-subtle"
        }`}
      >
        {achievement.name}
      </div>
      {/* flex-1 держит строку статуса у нижнего края при разной длине описаний */}
      <div
        className={`mt-1 flex-1 text-pretty text-[14px] leading-normal ${
          unlocked ? "text-ink-muted" : "text-locked-text"
        }`}
      >
        {achievement.description}
      </div>

      <div
        className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${
          unlocked ? tone.status : "text-locked-icon"
        }`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {unlocked ? "Получено" : "Закрыто"}
      </div>
    </div>
  );
}
