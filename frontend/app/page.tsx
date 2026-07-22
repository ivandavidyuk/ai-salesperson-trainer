"use client";

// Главная страница: приветствие, запуск тренировки, совет дня,
// статистика, последние разговоры и недельный прогресс.
// Все данные приходят одним запросом из GET /api/home.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AllConversationsModal from "@/app/components/AllConversationsModal";
import AppShell from "@/app/components/AppShell";
import ConversationRow from "@/app/components/ConversationRow";
import DailyCard from "@/app/components/DailyCard";
import ProgressPanel from "@/app/components/ProgressPanel";
import type { HomeData } from "@/lib/home";
import { formatDuration, greeting } from "@/lib/format";

// Карточка одного показателя статистики
function StatCard({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  if (accent) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-line-accent bg-surface-accent px-4 py-3 text-center">
        <div className="font-mono text-2xl text-brand-score">
          {value}
          {/* «/ 10» показываем только когда оценка есть */}
          {value !== "—" && (
            <span className="text-sm text-brand-score-muted"> / 10</span>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] text-brand-score-label">{label}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface-card px-4 py-3 text-center">
      <div className="font-mono text-[26px] text-ink">{value}</div>
      <div className="mt-0.5 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  // Локальные переключения избранного, чтобы не перезапрашивать всю страницу
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/home");
        if (!res.ok) throw new Error("request failed");
        const payload = (await res.json()) as HomeData;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Не удалось загрузить данные");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Оптимистично переключаем звезду и откатываем, если сервер не принял
  const handleToggleFavorite = useCallback(
    async (id: string, isFavorite: boolean) => {
      setFavorites((current) => ({ ...current, [id]: isFavorite }));
      try {
        const res = await fetch(`/api/sessions/${id}/favorite`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFavorite }),
        });
        if (!res.ok) throw new Error("request failed");
      } catch {
        setFavorites((current) => ({ ...current, [id]: !isFavorite }));
      }
    },
    []
  );

  const hasConversations = (data?.stats.total ?? 0) > 0;

  return (
    <AppShell title="Главная">
      {error && (
        <p className="px-7 py-6 text-sm text-danger-text">{error}</p>
      )}

      {!error && !data && (
        <p className="px-7 py-6 text-sm text-ink-muted">Загрузка…</p>
      )}

      {data && (
        <>
          <div className="px-7 pb-1 pt-[22px]">
            <div className="mb-3.5 text-[21px] font-semibold tracking-[-.01em] text-ink">
              {greeting()}, {data.user.firstName}
            </div>

            <div className="flex items-stretch gap-4">
              {/* Запуск тренировки */}
              <div className="flex min-h-[132px] flex-1 flex-col justify-between rounded-card bg-brand px-5 py-[18px] text-white">
                <div>
                  <div className="text-[19px] font-semibold tracking-[-.01em]">
                    Готовы начать подход?
                  </div>
                  <div className="mt-[7px] text-[13.5px] leading-normal text-brand-panel-text">
                    Нажмите кнопку «Начать тренировку», а затем выберите тип
                    тренировки и пациента.
                  </div>
                </div>
                <Link
                  href="/session"
                  className="mt-3.5 inline-flex items-center justify-center gap-2.5 self-stretch rounded-input bg-white px-5 py-[11px] text-[14.5px] font-semibold text-brand-hover transition-colors hover:bg-brand-panel-meta"
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-brand" />
                  Начать тренировку
                </Link>
              </div>

              <div className="flex flex-1">
                <DailyCard tip={data.daily.tip} motivation={data.daily.motivation} />
              </div>

              <div className="grid flex-1 grid-cols-2 gap-3">
                <StatCard value={String(data.stats.total)} label="разговоров всего" />
                <StatCard value={String(data.stats.thisWeek)} label="на этой неделе" />
                <StatCard
                  value={formatDuration(data.stats.avgDurationSec)}
                  label="средняя длина"
                />
                <StatCard
                  accent
                  value={data.stats.avgScore === null ? "—" : String(data.stats.avgScore)}
                  label="средняя оценка"
                />
              </div>
            </div>
          </div>

          <div className="flex items-stretch gap-6 px-7 pb-6 pt-4">
            {/* Прошлые разговоры */}
            <div className="flex flex-[2] flex-col">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="text-base font-semibold text-ink">
                  Прошлые разговоры
                </div>
                {hasConversations && (
                  <button
                    type="button"
                    onClick={() => setAllOpen(true)}
                    className="text-[13.5px] font-medium text-brand transition-colors hover:text-brand-hover"
                  >
                    Все →
                  </button>
                )}
              </div>

              <div className="max-h-[352px] flex-1 overflow-y-auto rounded-[14px] border border-line bg-surface-card">
                {data.recent.length === 0 ? (
                  <div className="flex h-full min-h-[180px] flex-col items-center justify-center px-6 text-center">
                    <div className="text-2xl">🎧</div>
                    <div className="mt-2 text-base font-semibold text-ink">
                      Первый разговор впереди
                    </div>
                    <p className="mt-1.5 max-w-[420px] text-[13.5px] leading-normal text-ink-muted">
                      Проведите живой голосовой разговор с ИИ-клиентом. Он
                      появится здесь вместе с расшифровкой, а позже — с разбором.
                    </p>
                  </div>
                ) : (
                  data.recent.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={{
                        ...conversation,
                        isFavorite:
                          favorites[conversation.id] ?? conversation.isFavorite,
                      }}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))
                )}
              </div>
            </div>

            <ProgressPanel
              metrics={data.progress.metrics}
              strength={data.progress.strength}
              growthPoint={data.progress.growthPoint}
            />
          </div>
        </>
      )}

      {allOpen && (
        <AllConversationsModal
          onClose={() => setAllOpen(false)}
          onToggleFavorite={handleToggleFavorite}
          overrides={favorites}
        />
      )}
    </AppShell>
  );
}
