// Панель «Разбор разговора» справа от расшифровки: исход сделки, общая
// оценка, оценки по пяти этапам, сильное место и точка роста.
//
// Чего здесь сознательно нет: цитат из разговора и списка невыполненных
// условий согласия. Иначе менеджер получил бы готовую инструкцию на
// следующую попытку, а тренажёр превратился бы в игру на запоминание
// (см. DEAL-OUTCOME.md).

import type { TranscriptReview } from "@/lib/transcript";
import Loader from "@/app/components/Loader";
import {
  OUTCOME_LABELS,
  SCORE_WARN_BELOW,
  STAGE_METRICS,
  isDealClosed,
  type DealOutcome,
} from "@/lib/score";

interface ReviewPanelProps {
  review: TranscriptReview | null;
  /**
   * Разбор ещё в работе: разговор только что закончился, оценщик считает.
   * Отличать это от «разбора не будет» обязательно — иначе менеджер видит
   * «Разбора нет» сразу после звонка, уходит со страницы и не возвращается.
   */
  pending?: boolean;
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

/**
 * Плашка исхода: печать впечатывается в разбор.
 *
 * Одна фраза без пояснений — «получилось» или «не получилось». Раз текста
 * почти нет, разницу держат плотность и движение: закрытая сделка это
 * тёмно-бирюзовый блок с белой печатью, незакрытая — тот же удар, но по
 * белому. Размер и вес у них одинаковые: упрёка в незакрытой сделке нет,
 * только факт.
 *
 * Единственное место в интерфейсе, где мы позволяем себе праздновать.
 * Анимация играет один раз при появлении разбора — все кадры объявлены
 * без `infinite` (см. tailwind.config.ts).
 */
function OutcomeStamp({ outcome }: { outcome: DealOutcome }) {
  const { title, stamp } = OUTCOME_LABELS[outcome];
  return <Stamp good={isDealClosed(outcome)} title={title} stamp={stamp} />;
}

/**
 * Итог этапной тренировки. Своей плашки не заводим: у менеджера уже есть
 * язык «получилось / не получилось», и учить его второму незачем — меняются
 * только слова.
 */
function DrillStamp({ passed }: { passed: boolean }) {
  return passed ? (
    <Stamp good title="Этап отработан" stamp="ЗАЧТЕНО" />
  ) : (
    <Stamp good={false} title="Этап не отработан" stamp="НЕ ЗАЧТЕНО" />
  );
}

function Stamp({
  good,
  title,
  stamp,
}: {
  good: boolean;
  title: string;
  stamp: string;
}) {
  const closed = good;

  return (
    <div
      className={`relative mb-4 flex items-center gap-[13px] overflow-hidden rounded-[14px] px-[18px] py-4 ${
        closed ? "bg-brand" : "border border-line bg-surface-card"
      }`}
    >
      {/* Вспышка в момент удара: белая по тёмному, красная по белому */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 ${
          closed ? "animate-flashveil bg-white" : "animate-flashveil bg-danger-strong"
        }`}
        style={closed ? undefined : { opacity: 0.12 }}
      />

      <span className="animate-stampin relative flex h-10 w-10 shrink-0 items-center justify-center">
        {/* Ударная волна */}
        <span
          aria-hidden="true"
          className={`animate-shock absolute inset-0 rounded-full border-2 ${
            closed ? "border-white/60" : "border-danger-border"
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full ${
            closed ? "bg-white" : "bg-danger-soft"
          }`}
        />
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={closed ? 3 : 2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`relative ${closed ? "text-brand" : "text-danger-strong"}`}
        >
          {closed ? <path d="M5 12.5l4.5 4.5L19 7" /> : <path d="M7 7l10 10M17 7L7 17" />}
        </svg>
      </span>

      <div
        className={`animate-textrise relative text-[18px] font-semibold tracking-[-.01em] ${
          closed ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </div>

      <span
        className={`animate-stampbadge absolute right-4 top-1/2 -mt-[13px] rounded-[7px] border-2 px-[9px] py-[3px] font-mono text-[11px] font-semibold tracking-[.14em] ${
          closed
            ? "border-white/45 text-white/80"
            : "border-danger-border text-danger-strong"
        }`}
      >
        {stamp}
      </span>
    </div>
  );
}

/** Разбор считается: показываем это явно, а не пустотой. */
function PendingReview() {
  return (
    <div className="rounded-xl border border-line px-[18px] py-8">
      <Loader label="Считаем разбор" />
      <p className="mt-3 text-center text-[13px] leading-normal text-ink-muted">
        Оценщик читает расшифровку целиком — обычно это занимает несколько
        секунд. Страница обновится сама, обновлять её вручную не нужно.
      </p>
    </div>
  );
}

export default function ReviewPanel({ review, pending = false }: ReviewPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface-card px-7 py-8">
      <div className="mb-4 text-base font-semibold text-ink">Разбор разговора</div>

      {pending && !review ? (
        <PendingReview />
      ) : !review ? (
        <div className="flex flex-col items-center rounded-xl border border-line bg-surface px-8 py-[18px]">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-line-soft text-ink-subtle">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 4h11l3 3v13H5z" />
              <path d="M9 12h6M9 16h4" />
            </svg>
          </span>
          <div className="mt-3 text-[15px] font-semibold text-ink">Разбора нет</div>
          <p className="mt-1.5 text-pretty text-center text-[13px] leading-normal text-ink-subtle">
            Оценка по этому разговору не появилась. Расшифровка на месте —
            её можно прочитать целиком.
          </p>
        </div>
      ) : (
        <>
          {/* Исход — главное, что менеджер должен увидеть первым:
              оценки отвечают «как ты работал», исход — «получилось или нет».
              У разборов старше механизма исхода нет вовсе, и тогда плашки
              просто не будет: это не третье состояние, а её отсутствие */}
          {review.drillPassed !== null && review.drillPassed !== undefined ? (
            <DrillStamp passed={review.drillPassed} />
          ) : (
            review.outcome && <OutcomeStamp outcome={review.outcome} />
          )}

          <div className="rounded-xl border border-line p-[18px]">
            <div className="flex items-center gap-3.5">
              <ScoreRing score={review.overallScore} />
              <div>
                <div className="text-sm font-semibold text-ink">Общая оценка</div>
                <div className="text-[12.5px] text-ink-subtle">
                  {review.drillPassed !== null && review.drillPassed !== undefined
                    ? "за упражнение, из 10"
                    : "среднее пяти этапов, из 10"}
                </div>
              </div>
            </div>

            <div className="mt-[18px] flex flex-col gap-3">
              {STAGE_METRICS.map(({ key, label }) => {
                const value = review[key];
                // Закрытие не оценивалось у разговоров, разобранных до
                // появления механизма исхода — там честнее прочерк, чем ноль
                if (value === null || value === undefined) {
                  return (
                    <div key={key}>
                      <div className="mb-1.5 flex justify-between gap-3 text-[12.5px] text-ink-muted">
                        <span>{label}</span>
                        <span className="font-mono text-ink-subtle">—</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-line-soft" />
                    </div>
                  );
                }
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
