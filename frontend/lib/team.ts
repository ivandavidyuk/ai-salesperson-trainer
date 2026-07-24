// Статистика отдела для руководителя: по строке на менеджера.
//
// Считается тем же, чем главная страница менеджера (lib/home.ts) — просто
// для каждого сотрудника: общее число разговоров, активность за неделю,
// средняя оценка и прогресс по этапам неделя к неделе.

import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import { averageScores, round1, startOfWeek } from "@/lib/home";
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
  /** Разговоров по дням за последние 7 суток, от старого к сегодняшнему */
  activity: number[];
  stages: TeamStageMetric[];
  strength: string | null;
  growthPoint: string | null;
  recent: TeamRecentConversation[];
}

/**
 * Собирает статистику по всем менеджерам. Руководителей в списке нет:
 * страница про отдел продаж, а не про того, кто им руководит.
 */
export async function getTeamStats(): Promise<TeamMemberStats[]> {
  const managers = await prisma.user.findMany({
    where: { role: UserRole.manager },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      avatarUpdatedAt: true,
    },
  });

  const now = new Date();
  const weekStart = startOfWeek(now);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

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
      const completed = { userId: manager.id, status: "completed" as const };

      const [
        total,
        week,
        scoreAgg,
        currentWeekAvg,
        prevWeekAvg,
        recentRows,
        lastReview,
        activityRows,
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
        avatarUpdatedAt: manager.avatarUpdatedAt?.toISOString() ?? null,
        total,
        week,
        avgScore: round1(scoreAgg._avg.overallScore),
        weekDelta:
          thisWeekOverall !== null && prevWeekOverall !== null
            ? round1(thisWeekOverall - prevWeekOverall)
            : null,
        bestScore: round1(scoreAgg._max.overallScore),
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
