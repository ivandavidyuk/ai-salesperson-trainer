"use client";

// Раздел «Статистика» — только для руководителя.
//
// По макету это витрина отдела: сводка с наградами, подиум из трёх лидеров
// и остальные менеджеры строками ниже. Вся детализация — в модалке, чтобы
// страница читалась с одного взгляда.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/app/components/AppShell";
import Loader from "@/app/components/Loader";
import TeamStatsModal from "@/app/components/TeamStatsModal";
import { initials, plural } from "@/lib/format";
import { PLACE_BANNER, PLACE_PILL, placeLabel } from "@/lib/podium";
import {
  DEALS_RATE_MIN_CONVERSATIONS,
  SCORE_TEXT_CLASS,
  formatDealsRate,
  scoreTone,
} from "@/lib/score";
import type { TeamMemberStats } from "@/lib/team";

/** Подписи дней под спарклайном: последний столбик — сегодня. */
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function scoreClass(score: number | null): string {
  return score === null ? "text-ink-subtle" : SCORE_TEXT_CLASS[scoreTone(score)];
}

function Avatar({
  manager,
  size,
  className = "",
}: {
  manager: TeamMemberStats;
  size: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft font-semibold text-brand ${className}`}
    >
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
  );
}

/** Столбики активности за неделю с подсказкой по наведению. */
function Sparkline({ activity }: { activity: number[] }) {
  const max = Math.max(...activity, 1);
  const today = new Date().getDay();

  return (
    <div className="flex h-[34px] items-end gap-[5px]">
      {activity.map((value, index) => {
        // Последний столбик — сегодня, значит первый был шесть дней назад
        const day = WEEKDAYS[(today - (activity.length - 1 - index) + 14) % 7];
        return (
          <div key={index} className="group relative flex h-full flex-1 items-end">
            <div
              style={{ height: `${(value / max) * 100}%` }}
              className={`min-h-[4px] w-full rounded-[3px] transition-colors ${
                value >= max * 0.66 ? "bg-brand" : "bg-brand-sparkline"
              } group-hover:bg-brand-hover`}
            />
            <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 translate-y-[3px] whitespace-nowrap rounded-[7px] bg-ink px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_8px_20px_-8px_rgba(12,26,24,.6)] transition-[opacity,transform] group-hover:translate-y-0 group-hover:opacity-100">
              {day} · {value}{" "}
              {plural(value, "тренировка", "тренировки", "тренировок")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex-1 rounded-[11px] border border-line-soft bg-surface px-2 py-[11px] text-center">
      <div className="font-mono text-[19px] text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-subtle">{label}</div>
    </div>
  );
}

/** Карточка подиума. Первое место стоит выше соседей. */
function PodiumCard({
  manager,
  place,
  onOpen,
}: {
  manager: TeamMemberStats;
  place: number;
  onOpen: () => void;
}) {
  return (
    <div style={{ paddingTop: place === 1 ? 0 : 48 }} className="w-[340px] shrink-0">
      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-card shadow-[0_1px_2px_rgba(20,40,38,.04)] transition-[box-shadow,transform] duration-200 hover:-translate-y-[3px] hover:shadow-[0_22px_44px_-26px_rgba(20,40,38,.42)]">
        <div className={`relative h-24 ${PLACE_BANNER[place] ?? "bg-surface-accent"}`}>
          <span
            className={`absolute left-3 top-3 z-[2] ${PLACE_PILL[place] ?? PLACE_PILL.other}`}
          >
            {placeLabel(place)}
          </span>
          <Avatar
            manager={manager}
            size={76}
            className="absolute -bottom-[30px] left-1/2 -translate-x-1/2 border-[length:3px] border-surface-card shadow-[0_4px_14px_-6px_rgba(20,40,38,.5)]"
          />
        </div>

        <div className="flex flex-1 flex-col px-5 pb-5 pt-[46px]">
          <div className="text-center text-[16.5px] font-semibold text-ink">
            {manager.name}
          </div>
          <div className="mt-0.5 text-center text-[12.5px] text-ink-subtle">
            {manager.jobTitle}
          </div>

          <div className="mt-4 flex items-baseline justify-center gap-[5px]">
            <span
              className={`font-mono text-[34px] font-medium leading-none ${scoreClass(manager.avgScore)}`}
            >
              {manager.avgScore ?? "—"}
            </span>
            <span className="font-mono text-[15px] text-ink-placeholder">/ 10</span>
          </div>
          <div className="mt-[5px] text-center text-[11.5px] uppercase tracking-[.04em] text-ink-subtle">
            средняя оценка по тренировкам
          </div>

          <div className="mt-[18px] flex gap-2.5">
            <MiniStat value={manager.total} label="разговоров" />
            <MiniStat value={manager.week} label="за неделю" />
            {/* Процент намеренно без цвета: средняя оценка про технику,
                процент про результат. Подкрасить его «в плохо» — и подиум
                превращается в табло позора, хотя 20% для холодного трафика
                может быть нормой */}
            <MiniStat
              value={formatDealsRate(manager.paidDeals, manager.dealTotal).label}
              label="закрыто"
            />
          </div>

          <div className="mt-[18px]">
            <div className="mb-2 text-[10.5px] uppercase tracking-[.1em] text-ink-placeholder">
              Активность · 7 дней
            </div>
            <Sparkline activity={manager.activity} />
          </div>

          <button
            type="button"
            onClick={onOpen}
            className="mt-[22px] inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Смотреть статистику
            <svg
              width="15"
              height="15"
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
          </button>
        </div>
      </div>
    </div>
  );
}

function OtherRow({
  manager,
  place,
  onOpen,
}: {
  manager: TeamMemberStats;
  place: number;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-[18px] rounded-[14px] border border-line bg-surface-card px-5 py-3.5">
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-bubble font-mono text-[13px] text-ink-muted">
        {place}
      </span>
      <Avatar manager={manager} size={44} />

      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-ink">{manager.name}</div>
        <div className="mt-px text-[12.5px] text-ink-subtle">{manager.jobTitle}</div>
      </div>

      <div className="w-24 text-center">
        <div className={`font-mono text-[19px] ${scoreClass(manager.avgScore)}`}>
          {manager.avgScore ?? "—"}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-subtle">ср. по трен.</div>
      </div>
      <div className="w-[84px] text-center">
        <div className="font-mono text-[19px] text-ink">{manager.total}</div>
        <div className="mt-0.5 text-[11px] text-ink-subtle">разговоров</div>
      </div>
      <div className="w-[84px] text-center">
        <div className="font-mono text-[19px] text-ink">{manager.week}</div>
        <div className="mt-0.5 text-[11px] text-ink-subtle">за неделю</div>
      </div>
      <div className="w-[84px] text-center">
        <div className="font-mono text-[19px] text-ink">
          {formatDealsRate(manager.paidDeals, manager.dealTotal).label}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-subtle">закрыто</div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 whitespace-nowrap rounded-[10px] border border-line-accent bg-surface-accent px-[18px] py-2.5 text-[13.5px] font-semibold text-brand-hover transition-colors hover:bg-brand-soft"
      >
        Смотреть статистику
      </button>
    </div>
  );
}

interface Award {
  manager: TeamMemberStats;
  label: string;
  tone: string;
  metric: string;
}

export default function StatsPage() {
  const [team, setTeam] = useState<TeamMemberStats[] | null>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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

  // Места считаются на клиенте: сервер отдаёт всё нужное, а порядок —
  // производная от средней оценки. Менеджеры без разборов уходят в конец:
  // сравнивать их не с чем, и в подиуме им не место.
  const ranked = useMemo(() => {
    if (!team) return [];
    return [...team].sort((a, b) => {
      if (a.avgScore === null && b.avgScore === null) return 0;
      if (a.avgScore === null) return 1;
      if (b.avgScore === null) return -1;
      return b.avgScore - a.avgScore;
    });
  }, [team]);

  const teamAvg = useMemo(() => {
    const scored = ranked.filter((m) => m.avgScore !== null);
    if (scored.length === 0) return null;
    const sum = scored.reduce((acc, m) => acc + (m.avgScore ?? 0), 0);
    return Math.round((sum / scored.length) * 10) / 10;
  }, [ranked]);

  // Процент по отделу считается по сумме разговоров, а не как среднее
  // процентов: иначе менеджер с тремя разговорами весил бы столько же,
  // сколько менеджер с тридцатью
  const teamDeals = useMemo(() => {
    const paid = ranked.reduce((acc, m) => acc + m.paidDeals, 0);
    const total = ranked.reduce((acc, m) => acc + m.dealTotal, 0);
    return formatDealsRate(paid, total);
  }, [ranked]);

  // Награды. Каждая считается по своему показателю и каждая может
  // отсутствовать: «прирост» без прошлой недели выдумывать нельзя.
  const awards = useMemo<Award[]>(() => {
    if (ranked.length === 0) return [];

    const leader = (value: (m: TeamMemberStats) => number | null) =>
      ranked.reduce<TeamMemberStats | null>((best, manager) => {
        const current = value(manager);
        if (current === null || current <= 0) return best;
        const top = best === null ? null : value(best);
        return top === null || current > top ? manager : best;
      }, null);

    const grinder = leader((m) => m.week);
    const improver = leader((m) => m.weekDelta);
    const marathoner = leader((m) => m.total);
    // «Закрыватель» — только среди тех, у кого разговоров достаточно:
    // один закрытый из одного даёт 100% и забрал бы награду ни за что
    const closer = leader((m) =>
      m.dealTotal >= DEALS_RATE_MIN_CONVERSATIONS ? m.paidDeals / m.dealTotal : null
    );

    const list: Award[] = [];
    if (grinder) {
      list.push({
        manager: grinder,
        label: "Трудяга",
        tone: "bg-brand-soft text-brand-hover",
        metric: `${grinder.week} ${plural(grinder.week, "тренировка", "тренировки", "тренировок")} за неделю`,
      });
    }
    if (improver) {
      list.push({
        manager: improver,
        label: "Работает над собой",
        tone: "bg-good-surface text-good",
        metric: `+${improver.weekDelta} к средней за неделю`,
      });
    }
    if (marathoner) {
      list.push({
        manager: marathoner,
        label: "Марафонец",
        tone: "bg-surface-bubble text-ink-muted",
        metric: `${marathoner.total} ${plural(marathoner.total, "разговор", "разговора", "разговоров")} всего`,
      });
    }
    if (closer) {
      list.push({
        manager: closer,
        label: "Закрыватель",
        tone: "bg-surface-accent text-brand-score",
        metric: `${formatDealsRate(closer.paidDeals, closer.dealTotal).label} закрытых сделок`,
      });
    }
    return list;
  }, [ranked]);

  // Подиум собирается, только если есть кого поставить на все три ступени:
  // пьедестал из одного человека выглядел бы насмешкой, а не витриной.
  const hasPodium = ranked.filter((m) => m.avgScore !== null).length >= 3;
  const podium = hasPodium ? [ranked[1], ranked[0], ranked[2]] : [];
  const others = hasPodium ? ranked.slice(3) : ranked;
  const placeOf = (manager: TeamMemberStats) =>
    ranked.findIndex((m) => m.id === manager.id) + 1;

  const openManager = ranked.find((m) => m.id === openId) ?? null;

  return (
    <AppShell title="Статистика">
      <div className="mx-auto w-full max-w-[1520px] px-10 pb-9 pt-[30px]">
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
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div>
                <h1 className="text-[21px] font-semibold tracking-[-.01em] text-ink">
                  Менеджеры отдела
                </h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {team
                    ? `${team.length} ${plural(team.length, "менеджер", "менеджера", "менеджеров")} · оценки за всё время, динамика — неделя к неделе`
                    : "Загружаем показатели"}
                </p>
              </div>
              {team && (
                <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-ink-subtle">
                  <span className="inline-block h-[7px] w-[7px] rounded-full bg-brand" />
                  Обновлено сегодня
                </div>
              )}
            </div>

            {!team && !error && (
              <div className="flex justify-center py-16">
                <Loader />
              </div>
            )}

            {error && (
              <p className="py-16 text-center text-sm text-danger-text">{error}</p>
            )}

            {team && team.length === 0 && (
              <p className="py-16 text-center text-sm text-ink-muted">
                В отделе пока нет менеджеров.
              </p>
            )}

            {team && team.length > 0 && (
              <div className="pt-[22px]">
                {/* Сводка: средняя по отделу и награды */}
                <div className="mx-auto mb-[26px] flex max-w-[1140px] items-stretch gap-6 rounded-2xl border border-line bg-surface-card px-[26px] py-5">
                  <div className="flex shrink-0 flex-col justify-center border-r border-line-soft pr-[26px]">
                    <div className="text-[11px] uppercase tracking-[.06em] text-ink-subtle">
                      Средняя оценка отдела
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <span
                        className={`font-mono text-[40px] font-medium leading-none ${scoreClass(teamAvg)}`}
                      >
                        {teamAvg ?? "—"}
                      </span>
                      <span className="font-mono text-base text-ink-placeholder">
                        / 10
                      </span>
                    </div>
                    <div className="mt-[7px] whitespace-nowrap text-xs text-ink-subtle">
                      {team.length}{" "}
                      {plural(team.length, "менеджер", "менеджера", "менеджеров")} ·
                      за неделю
                    </div>
                  </div>

                  {/* Процент по отделу — ориентир для менеджера: сравнение
                      идёт с отделом, а не со ста процентами */}
                  <div className="flex shrink-0 flex-col justify-center border-r border-line-soft pr-[26px]">
                    <div className="text-[11px] uppercase tracking-[.06em] text-ink-subtle">
                      Закрытых сделок
                    </div>
                    <div className="mt-1.5 font-mono text-[40px] font-medium leading-none text-ink">
                      {teamDeals.label}
                    </div>
                    <div className="mt-[7px] whitespace-nowrap text-xs text-ink-subtle">
                      {teamDeals.hint ?? "по всем разговорам отдела"}
                    </div>
                  </div>

                  {awards.length > 0 ? (
                    <div className="flex flex-1 gap-3.5">
                      {awards.map((award) => (
                        <div
                          key={award.label}
                          className="flex flex-1 items-center gap-3 rounded-xl border border-line-soft bg-surface px-3.5 py-3"
                        >
                          <Avatar manager={award.manager} size={40} />
                          <div className="min-w-0">
                            <span
                              className={`inline-block rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[.05em] ${award.tone}`}
                            >
                              {award.label}
                            </span>
                            <div className="mt-1.5 text-sm font-semibold text-ink">
                              {award.manager.name}
                            </div>
                            <div className="mt-px text-[11.5px] text-ink-subtle">
                              {award.metric}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center text-[13.5px] text-ink-muted">
                      Награды появятся, когда у менеджеров наберутся разговоры.
                    </div>
                  )}
                </div>

                {/* Подиум: второй, первый, третий */}
                {hasPodium && (
                  <div className="mx-auto mb-[30px] flex max-w-[1140px] items-start justify-center gap-[22px]">
                    {podium.map((manager) => (
                      <PodiumCard
                        key={manager.id}
                        manager={manager}
                        place={placeOf(manager)}
                        onOpen={() => setOpenId(manager.id)}
                      />
                    ))}
                  </div>
                )}

                {others.length > 0 && (
                  <div className="mx-auto max-w-[1140px]">
                    {hasPodium && (
                      <div className="mb-3.5 flex items-center gap-3">
                        <div className="text-sm font-semibold text-ink">
                          Остальные менеджеры
                        </div>
                        <div className="h-px flex-1 bg-line-soft" />
                      </div>
                    )}
                    <div className="flex flex-col gap-3">
                      {others.map((manager) => (
                        <OtherRow
                          key={manager.id}
                          manager={manager}
                          place={placeOf(manager)}
                          onOpen={() => setOpenId(manager.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {openManager && (
        <TeamStatsModal
          manager={openManager}
          place={placeOf(openManager)}
          onClose={() => setOpenId(null)}
        />
      )}
    </AppShell>
  );
}
