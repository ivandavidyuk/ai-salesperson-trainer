// Типы тренировки для мастера настройки.
//
// Работает пока только «Полный разговор»: backend играет захардкоженную роль
// (SYSTEM_PROMPT в backend/services/llm.py) и про этапы ничего не знает.
// Остальные типы показываем заблокированными — чтобы было видно, куда идём,
// но нельзя выбрать то, что ничего не изменит.
//
// Файл без Prisma: его импортирует клиентский компонент мастера.

export type TrainingGroup = "full" | "stage" | "special";

export interface TrainingType {
  id: string;
  title: string;
  desc: string;
  group: TrainingGroup;
  /** false — карточка видна, но выбрать нельзя */
  enabled: boolean;
}

export const TRAINING_TYPES: TrainingType[] = [
  {
    id: "full",
    title: "Полный разговор",
    desc: "Все четыре этапа подряд — от приветствия до закрытия",
    group: "full",
    enabled: true,
  },
  {
    id: "s1",
    title: "Установка контакта",
    desc: "Приветствие, представление, цель",
    group: "stage",
    enabled: false,
  },
  {
    id: "s2",
    title: "Растопить лёд",
    desc: "Снять напряжение, тёплый тон",
    group: "stage",
    enabled: false,
  },
  {
    id: "s3",
    title: "Выявление потребности",
    desc: "Вопросы и активное слушание",
    group: "stage",
    enabled: false,
  },
  {
    id: "s4",
    title: "Отработка возражений",
    desc: "Ответы на сомнения клиента",
    group: "stage",
    enabled: false,
  },
  {
    id: "intercept",
    title: "Перехват инициативы",
    desc: "Мягко вернуть управление беседой и удержать структуру",
    group: "special",
    enabled: false,
  },
];

// Заголовки групп в мастере и плашка группы на шаге «Обзор»
export const GROUP_LABELS: Record<TrainingGroup, string> = {
  full: "Полный сценарий",
  stage: "Отдельный этап разговора",
  special: "Спецнавык",
};

// Короткая версия для плашки рядом с выбранным типом
export const GROUP_SHORT: Record<TrainingGroup, string> = {
  full: "Полный сценарий",
  stage: "Отдельный этап",
  special: "Спецнавык",
};

export function findTrainingType(id: string | null): TrainingType | null {
  if (!id) return null;
  return TRAINING_TYPES.find((type) => type.id === id) ?? null;
}

// Оформление плашки сложности пациента — общее для мастера и карточки
export const DIFFICULTY = {
  easy: { label: "Лёгкий", pill: "bg-good-surface text-good", dot: "bg-good" },
  mid: { label: "Средний", pill: "bg-warn-surface text-warn", dot: "bg-warn" },
  hard: { label: "Сложный", pill: "bg-danger-soft text-danger-strong", dot: "bg-danger-strong" },
} as const;

export type DifficultyKey = keyof typeof DIFFICULTY;

/** Пациент в мастере — то, что отдаёт GET /api/patients */
export interface WizardPatient {
  id: string;
  name: string;
  description: string | null;
  anamnesis: string | null;
  difficulty: DifficultyKey;
  /** false — промпта для этого пациента ещё нет, выбрать нельзя */
  isActive: boolean;
}
