// Пороги оценок разговора. Вынесены отдельно, чтобы одно и то же число
// не означало разное в разных местах интерфейса: бейдж в списке разговоров
// и полосы этапов в разборе красятся по одной шкале.

/** Ниже этого значения оценка считается слабой и красится в янтарный. */
export const SCORE_WARN_BELOW = 6.2;

/** От этого значения оценка считается сильной (зелёный бейдж). */
export const SCORE_GOOD_FROM = 8;

/** Ниже этого значения оценка тревожная — красная. */
export const SCORE_BAD_BELOW = 4;

/**
 * Ступень оценки — общая для бейджей, цифр и полос.
 *
 * Появилась вместе со страницей статистики отдела: там у оценки есть красная
 * ступень, которой раньше не было, и без общего помощника одно и то же число
 * красилось бы на разных экранах по-разному.
 */
export type ScoreTone = "gold" | "good" | "brand" | "warn" | "bad";

export function scoreTone(score: number): ScoreTone {
  if (score >= 10) return "gold";
  if (score >= SCORE_GOOD_FROM) return "good";
  if (score >= SCORE_WARN_BELOW) return "brand";
  if (score >= SCORE_BAD_BELOW) return "warn";
  return "bad";
}

/** Цвет крупной цифры оценки. Плашки оформляются в ScoreBadge. */
export const SCORE_TEXT_CLASS: Record<ScoreTone, string> = {
  gold: "text-gold-text",
  good: "text-good",
  brand: "text-brand-hover",
  warn: "text-warn",
  bad: "text-danger-strong",
};

// Этапы сделки в порядке отображения. Ключ совпадает с полем SessionReview.
// Одни и те же метки идут и в недельный «Прогресс» на главной, и в разбор
// конкретного разговора.
export const STAGE_METRICS = [
  { key: "contactScore", label: "Установка контакта" },
  { key: "iceBreakerScore", label: "«Топка льда»" },
  { key: "needsScore", label: "Выявление потребности" },
  { key: "objectionsScore", label: "Отработка возражений" },
] as const;
