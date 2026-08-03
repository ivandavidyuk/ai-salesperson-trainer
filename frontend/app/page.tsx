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
import Loader from "@/app/components/Loader";
import ProgressPanel from "@/app/components/ProgressPanel";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import type { HomeData } from "@/lib/home";
import { formatDuration, greeting } from "@/lib/format";
import { formatDealsRate } from "@/lib/score";

// Карточка одного показателя статистики.
//
// Сетка на шесть колонок: три обычных показателя по две колонки в первом
// ряду, два акцентных по три — во втором. Пятая плитка появилась вместе
// с процентом сделок, и делить шесть на два ряда оказалось честнее, чем
// оставлять её одну в сетке 2×2.
function StatCard({
  value,
  label,
  suffix,
  span,
  accent = false,
}: {
  value: string;
  label: string;
  /** Приписка мелким после значения: «/ 10», «%» */
  suffix?: string;
  span: 2 | 3;
  accent?: boolean;
}) {
  const cls = accent
    ? "border-line-accent bg-surface-accent"
    : "border-line bg-surface-card";

  return (
    <div
      style={{ gridColumn: `span ${span}` }}
      className={`flex flex-col items-center justify-center rounded-xl border px-3 py-[11px] text-center ${cls}`}
    >
      <div
        className={`font-mono leading-[1.1] ${
          accent ? "text-2xl text-brand-score" : "text-[26px] text-ink"
        }`}
      >
        {value}
        {/* Приписку прячем у прочерка: «— / 10» читается как поломка */}
        {suffix && value !== "—" && (
          <span
            className={accent ? "text-[15px] text-brand-score-muted" : "text-sm text-ink-muted"}
          >
            {suffix}
          </span>
        )}
      </div>
      <div
        className={`mt-[3px] whitespace-nowrap text-[11.5px] ${
          accent ? "text-brand-score-label" : "text-ink-muted"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  // Мастер настройки тренировки — открывается кнопкой «Начать тренировку»
  const [setupOpen, setSetupOpen] = useState(false);
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
  // Знаменатель — только разговоры, где сделка могла случиться: этапные
  // тренировки в проценте закрытых сделок не участвуют
  const dealsRate = formatDealsRate(
    data?.stats.paidDeals ?? 0,
    data?.stats.dealTotal ?? 0
  );

  return (
    <AppShell title="Главная">
      {error && (
        <p className="px-7 py-6 text-sm text-danger-text">{error}</p>
      )}

      {!error && !data && (
        <div className="flex flex-1 items-center justify-center">
          <Loader label="Собираем вашу статистику" />
        </div>
      )}

      {data && (
        <>
          {/* Контент ограничен 1440px и центрируется: на 1680/1920 растут
              только боковые поля, колонки не расползаются */}
          <div className="mx-auto w-full max-w-[1760px] shrink-0 px-10 pb-1 pt-[26px]">
            <div className="mb-[22px]">
              <div className="text-[28px] font-bold tracking-[-.02em] text-ink">
                {greeting()}, {data.user.firstName} 👋
              </div>
              {/* Должность из профиля, а не подпись «менеджер по продажам»
                  для всех: у руководителя она своя */}
              {data.user.jobTitle && (
                <div className="mt-1 text-sm text-ink-subtle">
                  {data.user.jobTitle}
                </div>
              )}
            </div>

            {/* Пропорции по содержимому: старт шире, метрики фиксированы */}
            <div className="grid items-stretch gap-[18px] [grid-template-columns:minmax(320px,1.15fr)_minmax(300px,1fr)_380px]">
              {/* Запуск тренировки */}
              <div className="flex min-h-[150px] flex-col justify-between rounded-card bg-brand px-6 py-[22px] text-white">
                <div>
                  <div className="text-[19px] font-semibold tracking-[-.01em]">
                    Готовы начать подход?
                  </div>
                  <div className="mt-[7px] text-[13.5px] leading-normal text-brand-panel-text">
                    Нажмите кнопку «Начать тренировку», а затем выберите тип
                    тренировки и пациента.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSetupOpen(true)}
                  className="mt-[18px] inline-flex max-w-[260px] items-center justify-center gap-2.5 self-start rounded-input bg-white px-[22px] py-3 text-[14.5px] font-semibold text-brand-hover transition-colors hover:bg-brand-panel-meta"
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-brand" />
                  Начать тренировку
                </button>
              </div>

              <div className="flex">
                <DailyCard tip={data.daily.tip} motivation={data.daily.motivation} />
              </div>

              <div className="grid grid-cols-6 gap-3">
                <StatCard span={2} value={String(data.stats.total)} label="разговоров" />
                <StatCard span={2} value={String(data.stats.thisWeek)} label="за неделю" />
                <StatCard
                  span={2}
                  value={formatDuration(data.stats.avgDurationSec)}
                  label="средняя длина"
                />
                <StatCard
                  span={3}
                  accent
                  value={data.stats.avgScore === null ? "—" : String(data.stats.avgScore)}
                  suffix=" / 10"
                  label="средняя оценка"
                />
                {/* Знаменатель — все разговоры, а не только разобранные.
                    До пяти разговоров процент врёт, поэтому там «1 из 3» */}
                <StatCard
                  span={3}
                  accent
                  value={dealsRate.label}
                  label={dealsRate.hint ? "закрытых сделок · мало данных" : "закрытых сделок"}
                />
              </div>
            </div>
          </div>

          {/* Нижний ряд растягивается на всю оставшуюся высоту — под ним
              не остаётся пустоты, список скроллится внутри себя */}
          <div className="mx-auto flex w-full min-h-0 max-w-[1760px] flex-1 items-stretch gap-6 px-10 pb-8 pt-4">
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

              <div className="min-h-0 flex-1 overflow-y-auto rounded-[14px] border border-line bg-surface-card">
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

      {setupOpen && <TrainingSetupModal onClose={() => setSetupOpen(false)} />}
    </AppShell>
  );
}
