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

/** Галочка и крестик для строки «Предложение оплаты». */
function OfferMark({ offered }: { offered: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {offered ? <path d="M4 12.5l5 5L20 6.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

/**
 * Исход разговора — первое, что читает менеджер, раньше оценок.
 *
 * Разложен на два факта: попросил ли менеджер оплату и что ответил пациент.
 * Цветом при этом окрашены только иконка и полоска слева — «не закрыл»
 * не должно кричать поверх приличных оценок.
 */
function OutcomeCard({ outcome }: { outcome: DealOutcome }) {
  const { title, hint, tone, offered, answer } = OUTCOME_LABELS[outcome];
  const accent = {
    good: { bar: "border-l-good", chip: "bg-good-surface text-good", text: "text-good" },
    warn: { bar: "border-l-warn", chip: "bg-warn-surface text-warn", text: "text-warn" },
    bad: {
      bar: "border-l-danger-strong",
      chip: "bg-danger-soft text-danger-strong",
      text: "text-danger-strong",
    },
  }[tone];

  return (
    <div
      className={`mb-4 overflow-hidden rounded-xl border border-line border-l-[3px] ${accent.bar}`}
    >
      <div className="flex items-start gap-[13px] px-[17px] py-[15px]">
        <span
          className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${accent.chip}`}
        >
          <OfferMark offered={outcome === "paid"} />
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-subtle">
            Исход сделки
          </div>
          <div className="mt-1 text-[16.5px] font-semibold tracking-[-.005em] text-ink">
            {title}
          </div>
          <p className="mt-[3px] text-pretty text-[12.5px] leading-snug text-ink-muted">
            {hint}
          </p>
        </div>
      </div>

      <div className="flex items-stretch border-t border-line-soft bg-surface">
        <div className="min-w-0 flex-1 px-4 py-[9px]">
          <div className="font-mono text-[9.5px] uppercase tracking-[.1em] text-ink-placeholder">
            Предложение оплаты
          </div>
          <div
            className={`mt-[3px] flex items-center gap-1.5 text-[12.5px] font-semibold ${
              offered ? "text-good" : "text-danger-strong"
            }`}
          >
            <OfferMark offered={offered} />
            {offered ? "прозвучало" : "не прозвучало"}
          </div>
        </div>
        <div className="w-px bg-line" />
        <div className="min-w-0 flex-1 px-4 py-[9px]">
          <div className="font-mono text-[9.5px] uppercase tracking-[.1em] text-ink-placeholder">
            Ответ пациента
          </div>
          {/* Пусто не потому, что не знаем, а потому что отвечать было
              нечего — так «не попросил» отличается от «отказали»
              структурой, а не оттенком */}
          <div
            className={`mt-[3px] text-[12.5px] font-semibold ${
              answer ? accent.text : "text-ink-muted"
            }`}
          >
            {answer ?? "— нечего отвечать"}
          </div>
        </div>
      </div>
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
      <div className="text-base font-semibold text-ink">Разбор разговора</div>
      <p className="mb-4 mt-1.5 text-[13px] leading-normal text-ink-subtle">
        Сначала исход, затем оценки по этапам подхода и что забрать
        в следующий разговор.
      </p>

      {pending && !review ? (
        <PendingReview />
      ) : !review ? (
        <div className="rounded-xl border border-line px-[18px] py-5">
          <div className="text-sm font-semibold text-ink">Разбора нет</div>
          <p className="mt-1.5 text-[13px] leading-normal text-ink-muted">
            Обычно он появляется через несколько секунд после разговора.
            Если его нет и позже — значит разговор был слишком коротким
            либо разбор не удалось составить.
          </p>
        </div>
      ) : (
        <>
          {/* Исход — главное, что менеджер должен увидеть первым:
              оценки отвечают «как ты работал», исход — «получилось или нет».
              У разборов старше механизма исхода нет вовсе, и тогда блока
              просто не будет: это не четвёртое значение, а его отсутствие */}
          {review.outcome && <OutcomeCard outcome={review.outcome} />}

          <div className="rounded-xl border border-line p-[18px]">
            <div className="flex items-center gap-3.5">
              <ScoreRing score={review.overallScore} />
              <div>
                <div className="text-sm font-semibold text-ink">Общая оценка</div>
                <div className="text-[12.5px] text-ink-subtle">
                  среднее пяти этапов, из 10
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
