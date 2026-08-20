// Статистика отдела для руководителя: по строке на менеджера.
//
// Считается тем же, чем главная страница менеджера (lib/home.ts) — просто
// для каждого сотрудника: общее число разговоров, активность за неделю,
// средняя оценка и прогресс по этапам неделя к неделе.

import { prisma } from "@/lib/db";
import { завершённые } from "@/lib/statsWindow";
import { DealOutcome, UserRole } from "@prisma/client";
import { WEEK_DAYS, averageScores, round1, startOfWeek } from "@/lib/home";
import { STAGE_METRICS } from "@/lib/score";

export interface TeamStageMetric {
  key: string;
  label: string;
  /** Среднее за текущую неделю; null — на этой неделе разговоров не было */
  value: number | null;
  /** Разница с прошлой неделей; null — не с чем сравнивать */
  delta: number | null;
}

export interface TeamRecentConversation {
  id: string;
  topic: string | null;
  score: number | null;
}

export interface TeamMemberStats {
  id: string;
  name: string;
  jobTitle: string;
  avatarUpdatedAt: string | null;
  /**
   * Когда руководитель обнулил статистику. null — не обнулял.
   * Нужен интерфейсу, чтобы показать, что цифры считаются не с начала,
   * и предложить вернуть: иначе обнуление выглядит как потеря данных
   */
  statsResetAt: string | null;
  /** Завершённых разговоров за всё время */
  total: number;
  /** Из них на этой неделе */
  week: number;
  /** Средняя оценка за всё время; null — разборов нет */
  avgScore: number | null;
  /** Прирост средней за эту неделю к прошлой; null — не с чем сравнивать */
  weekDelta: number | null;
  /** Лучшая оценка за всё время; null — разборов нет */
  bestScore: number | null;
  /** Разговоров с исходом `paid`. Знаменатель — dealTotal, а не total */
  paidDeals: number;
  /**
   * Сколько было разговоров, в которых сделка могла случиться. Меньше total
   * на число этапных тренировок: в них до предложения оплаты не доходят,
   * и в проценте закрытых сделок им не место.
   */
  dealTotal: number;
  /** Разговоров по дням за последние 7 суток, от старого к сегодняшнему */
  activity: number[];
  stages: TeamStageMetric[];
  strength: string | null;
  growthPoint: string | null;
  recent: TeamRecentConversation[];
}

/**
 * Собирает статистику по менеджерам одной клиники. Руководителей в списке
 * нет: страница про отдел продаж, а не про того, кто им руководит.
 *
 * `organizationId` обязателен параметром, а не берётся внутри: раньше функция
 * считала по ВСЕМ менеджерам базы, и со второй клиникой руководитель увидел бы
 * чужой отдел. Значение null тоже осмысленно — это менеджеры, ни к какой
 * клинике не привязанные.
 */
export async function getTeamStats(
  organizationId: string | null
): Promise<TeamMemberStats[]> {
  const managers = await prisma.user.findMany({
    where: { role: UserRole.manager, organizationId },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      avatarUpdatedAt: true,
      statsResetAt: true,
    },
  });

  const now = new Date();
  const weekStart = startOfWeek(now);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - WEEK_DAYS);

  // Спарклайн активности: семь суток, заканчивая сегодняшними.
  // Границей берём полночь, иначе «день» съезжал бы по времени запроса.
  const ACTIVITY_DAYS = 7;
  const activityStart = new Date(now);
  activityStart.setHours(0, 0, 0, 0);
  activityStart.setDate(activityStart.getDate() - (ACTIVITY_DAYS - 1));

  // В статистику идут только завершённые разговоры: брошенные и текущие
  // искажали бы и счётчики, и средние
  return Promise.all(
    managers.map(async (manager) => {
      const completed = завершённые(manager.id, manager.statsResetAt);
      // Разговоры, где сделка вообще могла случиться. Этапные тренировки
      // не в счёт: там менеджер до предложения оплаты не доходит, и каждая
      // такая тренировка портила бы ему процент как поражение. Сессии без
      // типа — из времён до мастера настройки, они были полными
      const withDeal = {
        ...completed,
        OR: [{ trainingTypeId: null }, { trainingType: { scoresDeal: true } }],
      };

      const [
        total,
        week,
        scoreAgg,
        currentWeekAvg,
        prevWeekAvg,
        recentRows,
        lastReview,
        activityRows,
        paidCount,
        dealTotal,
      ] = await Promise.all([
          prisma.session.count({ where: completed }),
          prisma.session.count({
            where: { ...completed, startedAt: { gte: weekStart } },
          }),
          prisma.sessionReview.aggregate({
            where: { session: completed },
            _avg: { overallScore: true },
            _max: { overallScore: true },
          }),
          averageScores(manager.id, weekStart, now),
          averageScores(manager.id, prevWeekStart, weekStart),
          prisma.session.findMany({
            where: completed,
            orderBy: { startedAt: "desc" },
            take: 3,
            select: {
              id: true,
              topic: true,
              review: { select: { overallScore: true } },
            },
          }),
          // Сильная сторона и точка роста — из последнего разбора
          prisma.sessionReview.findFirst({
            where: { session: completed },
            orderBy: { createdAt: "desc" },
            select: { strength: true, growthPoint: true },
          }),
          // Одним запросом вместо семи count: дней всего семь, и раскладку
          // дешевле сделать в JS, чем гонять счётчик на каждый день
          prisma.session.findMany({
            where: { ...completed, startedAt: { gte: activityStart } },
            select: { startedAt: true },
          }),
          // Закрытые сделки. Делится на dealTotal — все разговоры, где сделка
          // могла случиться, а не только разобранные: незакрытая сделка
          // не должна прятаться за «разбор пока не пришёл»
          prisma.sessionReview.count({
            where: { session: withDeal, outcome: DealOutcome.paid },
          }),
          prisma.session.count({ where: withDeal }),
        ]);

      const activity = new Array<number>(ACTIVITY_DAYS).fill(0);
      for (const row of activityRows) {
        const day = new Date(row.startedAt);
        day.setHours(0, 0, 0, 0);
        const index = Math.floor(
          (day.getTime() - activityStart.getTime()) / 86_400_000
        );
        if (index >= 0 && index < ACTIVITY_DAYS) activity[index] += 1;
      }

      const thisWeekOverall = round1(currentWeekAvg.overallScore ?? null);
      const prevWeekOverall = round1(prevWeekAvg.overallScore ?? null);

      const stages: TeamStageMetric[] = STAGE_METRICS.map(({ key, label }) => {
        const value = round1(currentWeekAvg[key] ?? null);
        const previous = round1(prevWeekAvg[key] ?? null);
        return {
          key,
          label,
          value,
          // Дельту показываем только когда есть обе недели
          delta:
            value !== null && previous !== null ? round1(value - previous) : null,
        };
      });

      return {
        id: manager.id,
        name: `${manager.firstName} ${manager.lastName}`.trim(),
        jobTitle: manager.jobTitle ?? "Менеджер по продажам",
        statsResetAt: manager.statsResetAt?.toISOString() ?? null,
        avatarUpdatedAt: manager.avatarUpdatedAt?.toISOString() ?? null,
        total,
        week,
        avgScore: round1(scoreAgg._avg.overallScore),
        weekDelta:
          thisWeekOverall !== null && prevWeekOverall !== null
            ? round1(thisWeekOverall - prevWeekOverall)
            : null,
        bestScore: round1(scoreAgg._max.overallScore),
        paidDeals: paidCount,
        dealTotal,
        activity,
        stages,
        strength: lastReview?.strength ?? null,
        growthPoint: lastReview?.growthPoint ?? null,
        recent: recentRows.map((row) => ({
          id: row.id,
          topic: row.topic,
          score: round1(row.review?.overallScore ?? null),
        })),
      };
    })
  );
}
