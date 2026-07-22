// Панель «Разбор разговора» справа от расшифровки: общая оценка,
// оценки по этапам сделки, сильное место и точка роста.
//
// Механизма выставления оценок ещё нет, поэтому разбор есть только
// у демо-разговоров. У реальных на этом месте — заглушка.

import type { TranscriptReview } from "@/lib/transcript";
import { SCORE_WARN_BELOW, STAGE_METRICS } from "@/lib/score";

interface ReviewPanelProps {
  review: TranscriptReview | null;
}

// Кольцо общей оценки. Дуга рисуется через stroke-dasharray, поэтому
// заполнение честно отражает значение на шкале 0–10.
function ScoreRing({ score }: { score: number }) {
  const size = 56;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(Math.max(score, 0), 10) / 10;

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {/* -90°, чтобы дуга начиналась сверху, а не справа */}
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-brand-soft"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          className="stroke-brand"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-semibold text-ink">
        {score}
      </span>
    </span>
  );
}

export default function ReviewPanel({ review }: ReviewPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface-card px-7 py-8">
      <div className="text-base font-semibold text-ink">Разбор разговора</div>
      <p className="mb-5 mt-1.5 text-[13px] leading-normal text-ink-subtle">
        Автоматический разбор по этапам подхода: оценка, сильные места и точки
        роста для следующего разговора.
      </p>

      {!review ? (
        <div className="rounded-xl border border-line px-[18px] py-5">
          <div className="text-sm font-semibold text-ink">Скоро будет оценка</div>
          <p className="mt-1.5 text-[13px] leading-normal text-ink-muted">
            Автоматический разбор разговоров пока в работе. Когда он появится,
            здесь будут оценки по этапам, сильные места и точки роста.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-line p-[18px]">
            <div className="flex items-center gap-3.5">
              <ScoreRing score={review.overallScore} />
              <div>
                <div className="text-sm font-semibold text-ink">Общая оценка</div>
                <div className="text-[12.5px] text-ink-subtle">из 10</div>
              </div>
            </div>

            <div className="mt-[18px] flex flex-col gap-3">
              {STAGE_METRICS.map(({ key, label }) => {
                const value = review[key];
                return (
                  <div key={key}>
                    <div className="mb-1.5 flex justify-between gap-3 text-[12.5px] text-ink-muted">
                      <span>{label}</span>
                      <span className="font-mono text-ink">{value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <div
                        className={`h-full rounded-full ${
                          value < SCORE_WARN_BELOW ? "bg-warn" : "bg-brand"
                        }`}
                        // Шкала 0–10 переводится в проценты напрямую
                        style={{ width: `${(value / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            <div className="rounded-lg border border-line border-l-[3px] border-l-brand px-3.5 py-3">
              <div className="text-xs font-semibold text-brand-hover">
                Сильное место
              </div>
              <p className="mt-1 text-[13px] leading-snug text-ink-label">
                {review.strength}
              </p>
            </div>
            <div className="rounded-lg border border-line border-l-[3px] border-l-warn px-3.5 py-3">
              <div className="text-xs font-semibold text-warn">Точка роста</div>
              <p className="mt-1 text-[13px] leading-snug text-ink-label">
                {review.growthPoint}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
