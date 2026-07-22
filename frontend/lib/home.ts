// Сбор данных для главной страницы: ежедневный контент, статистика,
// последние разговоры и недельный прогресс.
//
// Вынесено из route handler, чтобы роут остался тонким, а логику подсчёта
// (границы недели, средние, дельты) можно было читать и менять в одном месте.

import { DailyContentKind } from "@prisma/client";
import { prisma } from "@/lib/db";

// Понедельник недели, к которой относится дата (00:00 локального времени).
// «Эта неделя» в статистике считается от него.
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  // getDay(): 0 — воскресенье, поэтому сдвигаем нумерацию к понедельнику
  const dayIndex = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - dayIndex);
  return result;
}

// Номер дня — по нему выбирается совет и мотивация.
// Тот же принцип, что в макете: элемент меняется раз в сутки без крона.
function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

// Округление до одного знака — оценки показываются как «7.4»
function round1(value: number | null): number | null {
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
  user: { firstName: string; lastName: string };
  daily: { tip: string | null; motivation: string | null };
  stats: {
    total: number;
    thisWeek: number;
    avgDurationSec: number | null;
    avgScore: number | null;
  };
  recent: HomeConversation[];
  progress: {
    metrics: ProgressMetric[];
    strength: string | null;
    growthPoint: string | null;
  };
}

// Этапы сделки в порядке отображения. Ключ совпадает с полем SessionReview.
const PROGRESS_METRICS = [
  { key: "contactScore", label: "Установка контакта" },
  { key: "iceBreakerScore", label: "«Топка льда»" },
  { key: "needsScore", label: "Выявление потребности" },
  { key: "objectionsScore", label: "Отработка возражений" },
] as const;

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
async function averageScores(userId: string, from: Date, to: Date) {
  const result = await prisma.sessionReview.aggregate({
    where: { session: { userId, startedAt: { gte: from, lt: to } } },
    _avg: {
      contactScore: true,
      iceBreakerScore: true,
      needsScore: true,
      objectionsScore: true,
    },
  });
  return result._avg;
}

export async function getHomeData(userId: string): Promise<HomeData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  if (!user) return null;

  const now = new Date();
  const weekStart = startOfWeek(now);
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  // В статистику попадают только завершённые разговоры: брошенные
  // и текущие искажали бы и счётчики, и среднюю длительность.
  const completed = { userId, status: "completed" as const };

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
  ] = await Promise.all([
    Promise.resolve(dayNumber(now)),
    prisma.session.count({ where: completed }),
    prisma.session.count({ where: { ...completed, startedAt: { gte: weekStart } } }),
    prisma.session.aggregate({ where: completed, _avg: { durationSec: true } }),
    prisma.sessionReview.aggregate({
      where: { session: completed },
      _avg: { overallScore: true },
    }),
    listConversations(userId, 3),
    averageScores(userId, weekStart, now),
    averageScores(userId, prevWeekStart, weekStart),
    prisma.sessionReview.findFirst({
      where: { session: { userId } },
      orderBy: { createdAt: "desc" },
      select: { strength: true, growthPoint: true },
    }),
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
    },
    recent: recentRows,
    progress: {
      metrics,
      strength: lastReview?.strength ?? null,
      growthPoint: lastReview?.growthPoint ?? null,
    },
  };
}
