// Вывод оценки закрытия и исхода сделки из оценок по этапам — для сидов.
//
// Зачем отдельным модулем: демо-данные наливают два скрипта (seed-demo и
// seed-team), и правило «средняя ниже порога — сделки нет» должно быть
// у них одно. Разъехавшись, они дали бы в базе разговоры, противоречащие
// самому механизму (см. DEAL-OUTCOME.md).
//
// В бою исход считается не так: его произносит вслух Тамара, а фиксирует
// итоговый оценщик (backend/services/scoring.py). Здесь мы лишь рисуем
// правдоподобную картинку, не нарушающую правил.

import type { DealOutcome } from "@prisma/client";

/** Порог допуска к согласию — тот же, что у backend (DEAL_SCORE_THRESHOLD). */
export const DEAL_THRESHOLD = 7;

export interface StageScores {
  contactScore: number;
  iceBreakerScore: number;
  needsScore: number;
  objectionsScore: number;
}

export interface DealResult {
  closingScore: number;
  outcome: DealOutcome;
  /** Среднее пяти этапов — ровно как считает итоговый оценщик */
  overallScore: number;
}

/**
 * Средняя по первым четырём этапам решает исход, она же задаёт оценку
 * закрытия: закрытие не бывает блестящим там, где к нему не подвели.
 *
 * @param notAsked разговор не дошёл до предложения оплатить
 */
export function deriveDealResult(scores: StageScores, notAsked = false): DealResult {
  const sum =
    scores.contactScore +
    scores.iceBreakerScore +
    scores.needsScore +
    scores.objectionsScore;
  const average = sum / 4;

  // Предложения не прозвучало — оценивать в закрытии почти нечего
  const closingScore = notAsked
    ? 2.4
    : average >= DEAL_THRESHOLD
      ? round1(Math.min(10, average + 0.7))
      : round1(Math.max(1, average - 1.6));

  const outcome: DealOutcome = notAsked
    ? "not_asked"
    : average >= DEAL_THRESHOLD
      ? "paid"
      : "refused";

  // Та же формула, что у итогового оценщика (scoring.py): среднее пяти
  // этапов. Руками общую оценку не задаём — иначе в демо появляются числа,
  // которых система выдать не может
  return { closingScore, outcome, overallScore: round1((sum + closingScore) / 5) };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
