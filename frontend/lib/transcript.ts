// Типы ответа GET /api/sessions/[id]/transcript — общие для страницы
// расшифровки и её компонентов.

import type { CaseService } from "@/lib/caseService";
import type { DealOutcome } from "@/lib/score";

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

/** Отметка по пункту чек-листа: не выполнено · частично · выполнено */
export type ChecklistMark = 0 | 1 | 2;

export interface ReviewChecklistItem {
  /** Сквозной номер 1–25: пункт всегда зовётся одним номером */
  n: number;
  name: string;
  /** Что значит «выполнено» — подсказка «Полностью: …» у 0 и 1 */
  full: string;
  mark: ChecklistMark;
  /** Индекс реплики менеджера в messages, по которой поставлена отметка.
      null у «не выполнено» — цитировать нечего */
  msg: number | null;
}

export interface ReviewChecklistStage {
  /** contact · iceBreaker · needs · objections · closing */
  stage: string;
  /** false — этапа в разговоре не было (пациент не возражал):
      ни числа, ни полоски, в общую не входит */
  measured: boolean;
  items: ReviewChecklistItem[];
}

export interface TranscriptReview {
  /** Есть всегда: у этапной тренировки это оценка самого упражнения */
  overallScore: number;
  // Оценки этапов. null означает «не измеряли», а не «ноль»: в этапной
  // тренировке считается только тренируемый этап, остальных в разговоре
  // не было. У профилактики и перехвата не заполнена ни одна — этапа
  // сделки под них не существует.
  contactScore: number | null;
  iceBreakerScore: number | null;
  needsScore: number | null;
  objectionsScore: number | null;
  /** null у этапных тренировок и у разборов до появления механизма исхода */
  closingScore: number | null;
  /** null у этапных тренировок: сделки там нет */
  outcome: DealOutcome | null;
  /** Отработан ли этап. null у полного разговора — там про это говорит outcome */
  drillPassed: boolean | null;
  strength: string;
  growthPoint: string;
  /** Разбор по пунктам. null у разборов до чек-листа и у упражнений без
      этапа сделки — тогда панель показывает оценки по-старому */
  checklist: ReviewChecklistStage[] | null;
  // judgeNotes сюда намеренно не попадает: разбор оценщика по условиям —
  // это готовый чек-лист для следующей попытки, менеджеру его не отдаём
}

export interface TranscriptData {
  session: {
    startedAt: string;
    /** null у брошенных сессий, которые никто не закрыл штатно */
    endedAt: string | null;
    durationSec: number | null;
    topic: string | null;
    patientName: string | null;
    /** Для «Ещё разговор» — повторить того же пациента и тот же тип.
        null у старых сессий, начатых до мастера настройки */
    patientId: string | null;
    trainingTypeId: string | null;
    /** Документ диагностики, показанный менеджеру по кнопке. null —
        не показывали (или разговор был до этой фичи), плашки нет */
    diagnosticsResult: string | null;
    diagnosticsShownAt: string | null;
    /** Услуга, подобранная под диагноз, — рядом с документом. null —
        не подобрана; отдаётся только вместе с показанным документом */
    diagnosticsService: CaseService | null;
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
