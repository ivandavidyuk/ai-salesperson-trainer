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
/** Чем закончился разговор — совпадает с enum DealOutcome в схеме БД. */
export type DealOutcome = "paid" | "refused" | "not_asked";

/**
 * Как показывать исход менеджеру.
 *
 * `not_asked` намеренно отделён от `refused`: это разные ошибки. В одном
 * случае менеджер не додал аргументов, в другом просто не дошёл до
 * предложения — и учить их надо по-разному.
 */
export const OUTCOME_LABELS: Record<
  DealOutcome,
  { title: string; hint: string; tone: "good" | "bad" | "warn" }
> = {
  paid: {
    title: "Сделка закрыта",
    hint: "Пациент согласился оплатить услугу",
    tone: "good",
  },
  refused: {
    title: "Сделка не закрыта",
    hint: "Предложение прозвучало, но пациент отказался",
    tone: "bad",
  },
  not_asked: {
    title: "Предложения не было",
    hint: "Разговор не дошёл до предложения оплатить",
    tone: "warn",
  },
};

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
// short — для «Прогресса» на главной: пять столбцов в колонке 380px дают
// по ~57px на подпись, и полные названия там обрезаются.
//
// В «Потребность» и «Возражения» стоит мягкий перенос (U+00AD, невидим
// в редакторе). Без него эти слова не влезают ни при каком читаемом кегле:
// одиннадцать букв в 57 пикселях не помещаются, а разорвать их по пробелу
// нельзя — слово одно. С мягким переносом строка честно уходит на вторую,
// вместо того чтобы обрезаться.
export const STAGE_METRICS = [
  { key: "contactScore", label: "Установка контакта", short: "Контакт" },
  { key: "iceBreakerScore", label: "«Топка льда»", short: "Лёд" },
  { key: "needsScore", label: "Выявление потребности", short: "Потреб­ность" },
  { key: "objectionsScore", label: "Отработка возражений", short: "Возра­жения" },
  { key: "closingScore", label: "Закрытие сделки", short: "Закрытие" },
] as const;
