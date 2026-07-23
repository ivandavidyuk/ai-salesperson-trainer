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

  // В статистику идут только завершённые разговоры: брошенные и текущие
  // искажали бы и счётчики, и средние
  return Promise.all(
    managers.map(async (manager) => {
      const completed = { userId: manager.id, status: "completed" as const };

      const [total, week, scoreAgg, currentWeekAvg, prevWeekAvg, recentRows, lastReview] =
        await Promise.all([
          prisma.session.count({ where: completed }),
          prisma.session.count({
            where: { ...completed, startedAt: { gte: weekStart } },
          }),
          prisma.sessionReview.aggregate({
            where: { session: completed },
            _avg: { overallScore: true },
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
        ]);

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
