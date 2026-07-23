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
