// Типы ответа GET /api/sessions/[id]/transcript — общие для страницы
// расшифровки и её компонентов.

import type { DealOutcome } from "@/lib/score";

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface TranscriptReview {
  overallScore: number;
  contactScore: number;
  iceBreakerScore: number;
  needsScore: number;
  objectionsScore: number;
  /** null у разговоров, разобранных до появления механизма исхода */
  closingScore: number | null;
  outcome: DealOutcome | null;
  strength: string;
  growthPoint: string;
  // judgeNotes сюда намеренно не попадает: разбор оценщика по условиям —
  // это готовый чек-лист для следующей попытки, менеджеру его не отдаём
}

export interface TranscriptData {
  session: {
    startedAt: string;
    durationSec: number | null;
    topic: string | null;
    patientName: string | null;
  };
  manager: { firstName: string; lastName: string };
  messages: TranscriptMessage[];
  /** null, пока разбора разговора нет — механизм оценки ещё не сделан */
  review: TranscriptReview | null;
}

// Смещение реплики от начала разговора в секундах. Отрицательное невозможно,
// но подстраховываемся: время сообщения приходит из БД, а startedAt сессии
// проставляется отдельно.
export function messageOffsetSec(startedAt: string, createdAt: string): number {
  const offset = (new Date(createdAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return Math.max(0, Math.round(offset));
}
