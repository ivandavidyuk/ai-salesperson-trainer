// Оформление мастера настройки тренировки.
//
// Сами типы тренировки живут в БД (модель TrainingType) — вместе с промптами,
// которые backend подмешивает в системный промпт. Здесь остаётся только то,
// что нужно интерфейсу: подписи групп и палитра сложности.
//
// Файл без Prisma: его импортирует клиентский компонент мастера.

export type TrainingGroup = "full" | "stage" | "special";

/** Тип тренировки в мастере — то, что отдаёт GET /api/training-types */
export interface WizardTrainingType {
  id: string;
  title: string;
  description: string;
  group: TrainingGroup;
  /** false — карточка видна, но выбрать нельзя */
  isActive: boolean;
}

// Заголовки групп в мастере
export const GROUP_LABELS: Record<TrainingGroup, string> = {
  full: "Полный сценарий",
  stage: "Отдельный этап разговора",
  special: "Спецнавык",
};

// Короткая версия для плашки рядом с выбранным типом на шаге «Обзор»
export const GROUP_SHORT: Record<TrainingGroup, string> = {
  full: "Полный сценарий",
  stage: "Отдельный этап",
  special: "Спецнавык",
};

// Оформление плашки сложности пациента — общее для мастера и карточки
export const DIFFICULTY = {
  easy: { label: "Лёгкий", pill: "bg-good-surface text-good", dot: "bg-good" },
  mid: { label: "Средний", pill: "bg-warn-surface text-warn", dot: "bg-warn" },
  hard: { label: "Сложный", pill: "bg-danger-soft text-danger-strong", dot: "bg-danger-strong" },
} as const;

export type DifficultyKey = keyof typeof DIFFICULTY;

/**
 * Делит подпись пациента «34 года · лазерная коррекция зрения» на возраст
 * и повод обращения.
 *
 * Склеенной строкой её пишет генератор случая, и до 24.08 она такой
 * и показывалась — подписью под именем, с обрезкой по ширине. Обрезался
 * всегда повод: возраст короткий и стоит первым. На карточке 360px это
 * съедало смысл целиком — «34 года · лазерная …», а выбирают по поводу.
 * Теперь возраст уходит в мета-строку к сложности, а повод становится
 * заголовком случая и переносится по словам.
 *
 * Разделителя может не оказаться, если генератор изменят: тогда вся строка
 * считается поводом. Потерять её хуже, чем показать целиком не в том месте.
 */
export function splitPatientSubtitle(description: string | null | undefined): {
  age: string | null;
  reason: string | null;
} {
  const text = description?.trim();
  if (!text) return { age: null, reason: null };
  const at = text.indexOf(" · ");
  if (at === -1) return { age: null, reason: text };
  return {
    age: text.slice(0, at).trim() || null,
    reason: text.slice(at + 3).trim() || null,
  };
}

/** Задание от руководителя — то, что отдаёт GET /api/assignments */
export interface Assignment {
  id: string;
  title: string;
  comment: string;
  /** ISO-дата или null, если срок не задан */
  dueAt: string | null;
  isPriority: boolean;
  patient: WizardPatient;
  trainingType: { id: string; title: string; isActive: boolean };
  /** Имя руководителя, выдавшего задание */
  author: string;
  /** Кому назначено — приходит только руководителю */
  assignee: {
    id: string;
    name: string;
    avatarUpdatedAt: string | null;
  } | null;
}

/** Пациент в мастере — то, что отдаёт GET /api/patients */
export interface WizardPatient {
  id: string;
  name: string;
  description: string | null;
  anamnesis: string | null;
  difficulty: DifficultyKey;
  /** false — промпта для этого пациента ещё нет, выбрать нельзя */
  isActive: boolean;
  // Разбор пациента приходит только руководителю — у менеджера этих
  // полей в ответе нет вовсе
  character?: string | null;
  objections?: string[];
  decisionMaker?: string | null;
  approach?: string | null;
}

/** Менеджер в шаге «Кому» — то, что отдаёт GET /api/users/managers */
export interface ManagerOption {
  id: string;
  name: string;
  jobTitle: string;
  avatarUpdatedAt: string | null;
}
