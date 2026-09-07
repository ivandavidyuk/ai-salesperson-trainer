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
  /**
   * Средняя оценка за всё время; null — разборов нет.
   *
   * Витрина отдела её больше не показывает — там всё считается за неделю.
   * Осталась ради карточки обнуления в профиле: там вопрос другой — что
   * именно руководитель сейчас сотрёт, а стирается как раз всё время
   */
  avgScore: number | null;
  /** Средняя за последние 7 суток; null — разговоров за неделю не было */
  weekScore: number | null;
  /** Прирост средней за эту неделю к прошлой; null — не с чем сравнивать */
  weekDelta: number | null;
  /** Лучшая оценка за неделю; null — разборов за неделю нет */
  bestScore: number | null;
  /** Разговоров с исходом `paid` за всё время. Знаменатель — dealTotal */
  paidDeals: number;
  /**
   * Сколько было разговоров, в которых сделка могла случиться. Меньше total
   * на число этапных тренировок: в них до предложения оплаты не доходят,
   * и в проценте закрытых сделок им не место.
   */
  dealTotal: number;
  /** Из них за последнюю неделю — по ним считается награда «Закрыватель» */
  weekPaidDeals: number;
  weekDealTotal: number;
  /** Разговоров по дням за последние 7 суток, от старого к сегодняшнему */
  activity: number[];
  stages: TeamStageMetric[];
  strength: string | null;
  growthPoint: string | null;
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
        lastReview,
        activityRows,
        paidCount,
        dealTotal,
        weekPaidCount,
        weekDealTotal,
      ] = await Promise.all([
          prisma.session.count({ where: completed }),
          prisma.session.count({
            where: { ...completed, startedAt: { gte: weekStart } },
          }),
          // Средняя за всё время нужна только карточке обнуления в профиле.
          // Лучшая оценка здесь больше не берётся: на витрине она недельная
          // и приходит из того же агрегата, что и недельная средняя
          prisma.sessionReview.aggregate({
            where: { session: completed },
            _avg: { overallScore: true },
          }),
          averageScores(manager.id, weekStart, now, manager.statsResetAt),
          averageScores(
            manager.id,
            prevWeekStart,
            weekStart,
            manager.statsResetAt
          ),
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
          // Те же сделки, но за неделю: награда «Закрыватель» считается
          // по неделе, как и всё остальное на витрине
          prisma.sessionReview.count({
            where: {
              session: { ...withDeal, startedAt: { gte: weekStart } },
              outcome: DealOutcome.paid,
            },
          }),
          prisma.session.count({
            where: { ...withDeal, startedAt: { gte: weekStart } },
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

      const thisWeekOverall = round1(currentWeekAvg.avg.overallScore ?? null);
      const prevWeekOverall = round1(prevWeekAvg.avg.overallScore ?? null);

      const stages: TeamStageMetric[] = STAGE_METRICS.map(({ key, label }) => {
        const value = round1(currentWeekAvg.avg[key] ?? null);
        const previous = round1(prevWeekAvg.avg[key] ?? null);
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
        weekScore: thisWeekOverall,
        weekDelta:
          thisWeekOverall !== null && prevWeekOverall !== null
            ? round1(thisWeekOverall - prevWeekOverall)
            : null,
        bestScore: round1(currentWeekAvg.best),
        paidDeals: paidCount,
        dealTotal,
        weekPaidDeals: weekPaidCount,
        weekDealTotal,
        activity,
        stages,
        strength: lastReview?.strength ?? null,
        growthPoint: lastReview?.growthPoint ?? null,
      };
    })
  );
}
