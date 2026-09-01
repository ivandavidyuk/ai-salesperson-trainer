// Сбор данных для главной страницы: ежедневный контент, статистика,
// последние разговоры и недельный прогресс.
//
// Вынесено из route handler, чтобы роут остался тонким, а логику подсчёта
// (границы недели, средние, дельты) можно было читать и менять в одном месте.

import { DailyContentKind, DealOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { завершённые } from "@/lib/statsWindow";
import { STAGE_METRICS } from "@/lib/score";

/**
 * Начало «недели» в статистике — семь суток назад от переданной даты.
 *
 * Был понедельник календарной недели, и это сбивало с толку: в понедельник
 * утром «Прогресс» обнулялся у человека с сотней разговоров, а во вторник
 * сравнивал два дня с семью. 04.08.2026 пользователь принял такое обнуление
 * за поломку статистики — и был прав в том смысле, что цифра ничего не значила.
 *
 * Скользящее окно ровнее: сравниваются всегда одинаковые отрезки, и результат
 * не зависит от того, в какой день недели человек открыл страницу.
 */
export const WEEK_DAYS = 7;

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - WEEK_DAYS);
  return result;
}

// Номер дня — по нему выбирается совет и мотивация.
// Тот же принцип, что в макете: элемент меняется раз в сутки без крона.
function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

// Округление до одного знака — оценки показываются как «7.4».
// Экспортируется: тем же округляется статистика отдела.
export function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

export interface HomeConversation {
  id: string;
  patientName: string | null;
  topic: string | null;
  startedAt: string;
  durationSec: number | null;
  score: number | null;
  isFavorite: boolean;
}

export interface ProgressMetric {
  key: string;
  label: string;
  /** Среднее за текущую неделю; null — данных нет */
  value: number | null;
  /** Разница с прошлой неделей; null — не с чем сравнивать */
  delta: number | null;
}

export interface HomeData {
  user: { firstName: string; lastName: string; jobTitle: string | null };
  daily: { tip: string | null; motivation: string | null };
  stats: {
    total: number;
    thisWeek: number;
    avgDurationSec: number | null;
    avgScore: number | null;
    /** Разговоров с исходом `paid`. Знаменатель — dealTotal, не total */
    paidDeals: number;
    /**
     * Сколько было разговоров, в которых сделка вообще могла случиться.
     * Отличается от total: этапные тренировки в него не входят — менеджер
     * там не доходит до предложения оплаты, и считать их непроданными
     * значило бы наказывать за учёбу.
     */
    dealTotal: number;
  };
  recent: HomeConversation[];
  progress: {
    metrics: ProgressMetric[];
    strength: string | null;
    growthPoint: string | null;
  };
}

// Этапы сделки берём из lib/score: те же метки и порядок нужны в разборе
// разговора, а он рисуется на клиенте — сюда Prisma тянуть нельзя
const PROGRESS_METRICS = STAGE_METRICS;

/**
 * Сколько разговоров показать на главной в блоке «Прошлые разговоры».
 *
 * Блок тянется на всю высоту колонки (`flex-1` в page.tsx), поэтому при трёх
 * строках под ними оставалась пустота в половину блока — у новичка это
 * выглядело как недоделанный экран.
 *
 * Восемь — сколько строк по 45 пикселей помещается в блок на десктопе,
 * под который рисовался макет. На экране ниже лишние уедут под прокрутку:
 * она у блока уже есть (`overflow-y-auto`), и прокрутка честнее пустоты.
 * Полный список открывается кнопкой «Все» — там лимита нет вовсе.
 */
const НЕДАВНИХ_РАЗГОВОРОВ = 8;

// Завершённые разговоры пользователя, свежие сверху.
// limit не задан — вернём все (для модалки «Все разговоры»).
export async function listConversations(
  userId: string,
  limit?: number
): Promise<HomeConversation[]> {
  const rows = await prisma.session.findMany({
    where: { userId, status: "completed" },
    orderBy: { startedAt: "desc" },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      topic: true,
      startedAt: true,
      durationSec: true,
      isFavorite: true,
      patient: { select: { name: true } },
      review: { select: { overallScore: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    patientName: row.patient?.name ?? null,
    topic: row.topic,
    startedAt: row.startedAt.toISOString(),
    durationSec: row.durationSec,
    score: round1(row.review?.overallScore ?? null),
    isFavorite: row.isFavorite,
  }));
}

// Берёт элемент дня из списка: список крутится по кругу по номеру дня
async function pickDaily(kind: DailyContentKind, day: number): Promise<string | null> {
  const items = await prisma.dailyContent.findMany({
    where: { kind, isActive: true },
    orderBy: { position: "asc" },
    select: { text: true },
  });
  if (items.length === 0) return null;
  // Остаток берём с поправкой на отрицательные значения
  const index = ((day % items.length) + items.length) % items.length;
  return items[index].text;
}

// Средние оценки по этапам за интервал. null, если разборов в нём нет.
// Средние оценки по этапам за период. Экспортируется: тем же считается
// статистика отдела у руководителя.
export async function averageScores(userId: string, from: Date, to: Date) {
  const result = await prisma.sessionReview.aggregate({
    where: { session: { userId, startedAt: { gte: from, lt: to } } },
    _avg: {
      contactScore: true,
      iceBreakerScore: true,
      needsScore: true,
      objectionsScore: true,
      // Пятый этап. У разговоров, разобранных до появления механизма исхода,
      // он null — Prisma такие строки в среднем не учитывает, и это верно:
      // «не измеряли» не должно тянуть среднюю вниз
      closingScore: true,
      // Общая оценка нужна статистике отдела: по ней считается прирост
      // за неделю. «Прогресс» на главной это поле просто не читает.
      overallScore: true,
    },
  });
  return result._avg;
}

export async function getHomeData(userId: string): Promise<HomeData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      jobTitle: true,
      statsResetAt: true,
      organizationId: true,
    },
  });
  if (!user) return null;

  const now = new Date();
  const weekStart = startOfWeek(now);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - WEEK_DAYS);

  // В статистику попадают только завершённые разговоры: брошенные
  // и текущие искажали бы и счётчики, и среднюю длительность.
  const completed = завершённые(userId, user.statsResetAt);

  // Разговоры, в которых сделка вообще могла случиться. Этапные тренировки
  // сюда не входят: менеджер там не доходит до предложения оплаты, и каждая
  // такая тренировка проседала бы в проценте закрытых сделок как поражение.
  // Счётчик количества тренировок при этом считает всё подряд — учиться
  // навыку не менее ценно, чем проводить полный разговор.
  //
  // trainingTypeId = null — разговоры, начатые до мастера настройки: они были
  // полными, и терять их из знаменателя нельзя.
  const withDeal = {
    ...completed,
    OR: [{ trainingTypeId: null }, { trainingType: { scoresDeal: true } }],
  };

  const [
    day,
    total,
    thisWeek,
    durationAgg,
    scoreAgg,
    recentRows,
    currentWeekAvg,
    prevWeekAvg,
    lastReview,
    paidCount,
    dealTotal,
  ] = await Promise.all([
    Promise.resolve(dayNumber(now)),
    prisma.session.count({ where: completed }),
    prisma.session.count({ where: { ...completed, startedAt: { gte: weekStart } } }),
    prisma.session.aggregate({ where: completed, _avg: { durationSec: true } }),
    prisma.sessionReview.aggregate({
      where: { session: completed },
      _avg: { overallScore: true },
    }),
    listConversations(userId, НЕДАВНИХ_РАЗГОВОРОВ),
    averageScores(userId, weekStart, now),
    averageScores(userId, prevWeekStart, weekStart),
    prisma.sessionReview.findFirst({
      where: { session: { userId } },
      orderBy: { createdAt: "desc" },
      select: { strength: true, growthPoint: true },
    }),
    // Закрытые сделки. Знаменатель — все разговоры, где сделка могла
    // случиться (dealTotal), а не только разобранные: незакрытая сделка
    // не должна прятаться за «разбор пока не пришёл»
    prisma.sessionReview.count({
      where: { session: withDeal, outcome: DealOutcome.paid },
    }),
    prisma.session.count({ where: withDeal }),
  ]);

  const [tip, motivation] = await Promise.all([
    pickDaily(DailyContentKind.tip, day),
    pickDaily(DailyContentKind.motivation, day),
  ]);

  const metrics: ProgressMetric[] = PROGRESS_METRICS.map(({ key, label }) => {
    const current = round1(currentWeekAvg[key] ?? null);
    const previous = round1(prevWeekAvg[key] ?? null);
    return {
      key,
      label,
      value: current,
      // Дельту показываем только когда есть обе недели
      delta: current !== null && previous !== null ? round1(current - previous) : null,
    };
  });

  return {
    user,
    daily: { tip, motivation },
    stats: {
      total,
      thisWeek,
      avgDurationSec:
        durationAgg._avg.durationSec === null
          ? null
          : Math.round(durationAgg._avg.durationSec),
      avgScore: round1(scoreAgg._avg.overallScore ?? null),
      paidDeals: paidCount,
      dealTotal,
    },
    recent: recentRows,
    progress: {
      metrics,
      strength: lastReview?.strength ?? null,
      growthPoint: lastReview?.growthPoint ?? null,
    },
  };
}
