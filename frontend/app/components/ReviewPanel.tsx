"use client";

// Панель «Разбор разговора» справа от расшифровки: исход сделки, общая
// оценка, разбор по пунктам чек-листа и два вывода — сильное место и точка
// роста.
//
// Оценка этапа — сумма отметок по пяти действиям (0 / 1 / 2), и панель
// показывает именно их: у каждого пункта слово состояния, у не сделанного
// до конца — подсказка «Полностью: …», у сделанного — реплика, по которой
// оценщик его засчитал. Так менеджер видит, чего не хватило до десятки,
// а не гадает по числу. Разборы старше чек-листа (checklist = null)
// показываются полосками, как раньше.
//
// Чего здесь сознательно нет: списка невыполненных условий согласия
// пациента. Иначе менеджер получил бы готовую инструкцию на следующую
// попытку, а тренажёр превратился бы в игру на запоминание
// (см. DEAL-OUTCOME.md). Реплика под пунктом — про технику менеджера,
// а не про условия пациента.

import { useState } from "react";
import {
  messageOffsetSec,
  type ChecklistMark,
  type ReviewChecklistItem,
  type ReviewChecklistStage,
  type TranscriptMessage,
  type TranscriptReview,
} from "@/lib/transcript";
import { formatDuration } from "@/lib/format";
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
  /**
   * Почему разбора нет, когда это известно заранее. «no-messages» — в разговоре
   * ни одной реплики (микрофон не поднялся, сессию закрыли сразу): оценщик
   * такое не разбирает, и говорить «оценка не появилась» было бы неправдой
   */
  emptyReason?: "no-messages";
  /** Реплики разговора — по индексу из чек-листа берётся цитата под пунктом */
  messages?: TranscriptMessage[];
  /** Старт разговора — для времени реплики под цитатой */
  startedAt?: string;
  /** «Показать в диалоге»: страница прокручивает к реплике и подсвечивает её */
  onShowMessage?: (index: number) => void;
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
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[16.5px] font-semibold text-ink">
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
        className={`animate-textrise relative text-[19.5px] font-semibold tracking-[-.01em] ${
          closed ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </div>

      <span
        className={`animate-stampbadge absolute right-4 top-1/2 -mt-[13px] rounded-[7px] border-2 px-[9px] py-[3px] font-mono text-[12.5px] font-semibold tracking-[.14em] ${
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
      <p className="mt-3 text-center text-[14.5px] leading-normal text-ink-muted">
        Оценщик читает расшифровку целиком — обычно это занимает несколько
        секунд. Страница обновится сама, обновлять её вручную не нужно.
      </p>
    </div>
  );
}

// --- Разбор по пунктам -------------------------------------------------------

/**
 * Слово состояния и метка перед названием — одно и то же, сказанное дважды:
 * залитая точка — выполнено, обведённая — частично, бледная — не выполнено.
 * Это метка, а не шкала: масштаба у неё нет. Красного в пунктах нет вовсе —
 * разбор считает выполненное, а не ошибки.
 */
const MARK_STYLE: Record<
  ChecklistMark,
  { word: string; wordClass: string; dotClass: string }
> = {
  0: {
    word: "не выполнено",
    wordClass: "text-ink-subtle",
    dotClass: "border-line-strong bg-surface-card",
  },
  1: {
    word: "частично",
    wordClass: "text-ink-muted",
    dotClass: "border-brand bg-surface-card",
  },
  2: {
    word: "выполнено",
    wordClass: "text-brand-hover",
    dotClass: "border-brand bg-brand",
  },
};

/** Название этапа — то же, что в «Прогрессе» на главной и в полосках. */
function stageLabel(stage: string): string {
  return STAGE_METRICS.find((metric) => metric.key === `${stage}Score`)?.label ?? stage;
}

/** Оценка этапа — сумма отметок по пяти действиям, 0–10 */
function stageScore(items: ReviewChecklistItem[]): number {
  return items.reduce((sum, item) => sum + item.mark, 0);
}

const STAGE_COUNT_WORDS: Record<number, string> = {
  2: "двух",
  3: "трёх",
  4: "четырёх",
  5: "пяти",
};

/** Реплика менеджера под пунктом: текст и время от начала разговора */
interface Quote {
  index: number;
  text: string;
  offsetSec: number;
}

function quoteFor(
  item: ReviewChecklistItem,
  messages: TranscriptMessage[] | undefined,
  startedAt: string | undefined
): Quote | null {
  if (item.msg === null || !messages || !startedAt) return null;
  const message = messages[item.msg];
  if (!message) return null;
  return {
    index: item.msg,
    text: message.text,
    offsetSec: messageOffsetSec(startedAt, message.createdAt),
  };
}

function StageBar({ score }: { score: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
      <div
        className={`h-full rounded-full ${score < SCORE_WARN_BELOW ? "bg-warn" : "bg-brand"}`}
        // Шкала 0–10 переводится в проценты напрямую
        style={{ width: `${(score / 10) * 100}%` }}
      />
    </div>
  );
}

function QuoteBlock({ quote, onShow }: { quote: Quote; onShow?: (index: number) => void }) {
  return (
    <div className="ml-[33px] mt-[9px] rounded-r-lg border border-l-2 border-line border-l-brand bg-surface-card px-3 py-[9px]">
      <div className="text-pretty text-[14px] leading-normal text-ink">«{quote.text}»</div>
      <div className="mt-1.5 flex items-baseline gap-2.5">
        <span className="font-mono text-[12.5px] text-ink-subtle">
          Менеджер · {formatDuration(quote.offsetSec)}
        </span>
        {onShow && (
          <button
            type="button"
            onClick={() => onShow(quote.index)}
            className="text-[13px] text-brand hover:text-brand-hover"
          >
            показать в диалоге
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Пункт чек-листа. У «частично» и «не выполнено» раскрыта подсказка
 * «Полностью: …» — дословно из утверждённого списка; у «частично» под ней
 * реплика, по которой поставлена отметка. У выполненного пункта подсказка
 * не нужна: он уже полный, — а реплику можно вызвать ссылкой.
 */
function ChecklistItemRow({
  item,
  quote,
  onShow,
}: {
  item: ReviewChecklistItem;
  quote: Quote | null;
  onShow?: (index: number) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const style = MARK_STYLE[item.mark];
  const showFull = item.mark < 2;
  const showQuote = quote !== null && (item.mark === 1 || revealed);
  const canReveal = quote !== null && item.mark === 2 && !revealed;

  return (
    <div className="border-t border-line-soft py-[11px]">
      <div className="flex items-center gap-[9px]">
        <span className="w-[15px] shrink-0 font-mono text-xs text-ink-placeholder">
          {item.n}
        </span>
        <span
          aria-hidden="true"
          className={`h-[9px] w-[9px] shrink-0 rounded-full border-[length:1.5px] ${style.dotClass}`}
        />
        <span className="flex-1 text-[14px] leading-snug text-ink">{item.name}</span>
        {canReveal && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="whitespace-nowrap text-[13px] text-brand hover:text-brand-hover"
          >
            реплика
          </button>
        )}
        <span className={`whitespace-nowrap text-[13px] ${style.wordClass}`}>{style.word}</span>
      </div>
      {showFull && (
        <div className="ml-[33px] mt-2 text-pretty text-[13.5px] leading-normal text-ink-label">
          <span className="font-semibold text-brand-hover">Полностью: </span>
          {item.full}
        </div>
      )}
      {showQuote && quote && <QuoteBlock quote={quote} onShow={onShow} />}
    </div>
  );
}

function ChecklistItems({
  stage,
  messages,
  startedAt,
  onShow,
}: {
  stage: ReviewChecklistStage;
  messages?: TranscriptMessage[];
  startedAt?: string;
  onShow?: (index: number) => void;
}) {
  return (
    <div className="rounded-[10px] border border-line-soft bg-surface px-3.5 pb-2.5 pt-1">
      {stage.items.map((item) => (
        <ChecklistItemRow
          key={item.n}
          item={item}
          quote={quoteFor(item, messages, startedAt)}
          onShow={onShow}
        />
      ))}
    </div>
  );
}

/** Этап, которого в разговоре не было: ни числа, ни полоски — пунктир и фраза */
function UnmeasuredStage({ label }: { label: string }) {
  return (
    <div className="border-t border-line-soft py-[13px]">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-[14px] text-ink">{label}</span>
        <span className="text-[13px] text-ink-subtle">не измерен</span>
      </div>
      <div className="mt-[11px] border-t border-dotted border-disabled" />
      <p className="mt-[9px] text-pretty text-[13px] leading-normal text-ink-subtle">
        Пациент не возражал — этапа в этом разговоре не было. В общую оценку не входит.
      </p>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`leading-none ${open ? "text-brand" : "text-ink-subtle"}`}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {open ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
    </span>
  );
}

/**
 * Полный разговор: пять этапов аккордеоном, открыт один. По умолчанию —
 * первый этап, где есть пункт не «выполнено»: именно туда менеджер смотрит,
 * спрашивая «почему не десять».
 */
function ConversationChecklist({
  stages,
  messages,
  startedAt,
  onShow,
}: {
  stages: ReviewChecklistStage[];
  messages?: TranscriptMessage[];
  startedAt?: string;
  onShow?: (index: number) => void;
}) {
  const measured = stages.filter((stage) => stage.measured);
  const firstGap = stages.findIndex(
    (stage) => stage.measured && stage.items.some((item) => item.mark < 2)
  );
  const [open, setOpen] = useState<number | null>(
    firstGap >= 0 ? firstGap : stages.findIndex((stage) => stage.measured)
  );

  const done = measured.reduce(
    (sum, stage) => sum + stage.items.filter((item) => item.mark === 2).length,
    0
  );
  const total = measured.length * 5;

  return (
    <>
      <div className="mt-4 border-t border-line-soft pt-3.5 text-[14px] text-ink">
        Выполнено{" "}
        <b>
          {done} из {total}
        </b>{" "}
        пунктов. Чтобы узнать подробнее — раскройте этапы
      </div>

      <div className="mt-1.5">
        {stages.map((stage, index) => {
          const label = stageLabel(stage.stage);
          if (!stage.measured) {
            return <UnmeasuredStage key={stage.stage} label={label} />;
          }
          const isOpen = open === index;
          const score = stageScore(stage.items);
          return (
            <div key={stage.stage} className="border-t border-line-soft py-[13px]">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : index)}
                aria-expanded={isOpen}
                className="block w-full text-left"
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-[14px] text-ink">{label}</span>
                  <span className="font-mono text-[14px] font-semibold text-ink">
                    {score}
                  </span>
                  <span className="font-mono text-[12.5px] text-ink-placeholder">/ 10</span>
                  <Chevron open={isOpen} />
                </div>
                <div className="mt-[9px]">
                  <StageBar score={score} />
                </div>
              </button>
              {isOpen && (
                <div className="mt-3">
                  <ChecklistItems
                    stage={stage}
                    messages={messages}
                    startedAt={startedAt}
                    onShow={onShow}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Этапная тренировка: этап один, пункты открыты сразу — прятать нечего */
function DrillChecklist({
  stage,
  messages,
  startedAt,
  onShow,
}: {
  stage: ReviewChecklistStage;
  messages?: TranscriptMessage[];
  startedAt?: string;
  onShow?: (index: number) => void;
}) {
  const done = stage.items.filter((item) => item.mark === 2).length;
  return (
    <>
      <div className="mt-4 border-t border-line-soft pt-3.5 text-[14px] text-ink">
        Выполнено{" "}
        <b>
          {done} из {stage.items.length}
        </b>{" "}
        пунктов
      </div>
      <div className="mt-3">
        <StageBar score={stageScore(stage.items)} />
      </div>
      <div className="mt-3.5">
        <ChecklistItems
          stage={stage}
          messages={messages}
          startedAt={startedAt}
          onShow={onShow}
        />
      </div>
    </>
  );
}

/** Разбор до чек-листа: пять полосок без раскрытия, как было */
function LegacyStages({ review }: { review: TranscriptReview }) {
  return (
    <div className="mt-[18px] flex flex-col gap-3">
      {STAGE_METRICS.map(({ key, label }) => {
        const value = review[key];
        // Закрытие не оценивалось у разговоров, разобранных до
        // появления механизма исхода — там честнее прочерк, чем ноль
        if (value === null || value === undefined) {
          return (
            <div key={key}>
              <div className="mb-1.5 flex justify-between gap-3 text-[14px] text-ink-muted">
                <span>{label}</span>
                <span className="font-mono text-ink-subtle">—</span>
              </div>
              <div className="h-1.5 rounded-full bg-line-soft" />
            </div>
          );
        }
        return (
          <div key={key}>
            <div className="mb-1.5 flex justify-between gap-3 text-[14px] text-ink-muted">
              <span>{label}</span>
              <span className="font-mono text-ink">{value}</span>
            </div>
            <StageBar score={value} />
          </div>
        );
      })}
    </div>
  );
}

export default function ReviewPanel({
  review,
  pending = false,
  emptyReason,
  messages,
  startedAt,
  onShowMessage,
}: ReviewPanelProps) {
  const isDrill =
    review !== null && review.drillPassed !== null && review.drillPassed !== undefined;
  const checklist = review?.checklist && review.checklist.length > 0 ? review.checklist : null;
  const measuredCount = checklist ? checklist.filter((stage) => stage.measured).length : 0;

  // Подпись под кольцом говорит, из чего сложилась оценка. У полного
  // разговора без чек-листа этапов пять всегда; с чек-листом — сколько
  // измерено: возражений могло не быть
  const ringCaption = isDrill
    ? checklist
      ? "один этап, из 10"
      : "за упражнение, из 10"
    : checklist
      ? `среднее ${STAGE_COUNT_WORDS[measuredCount] ?? measuredCount} этапов, из 10`
      : "среднее пяти этапов, из 10";

  return (
    <div className="flex-1 overflow-y-auto bg-surface-card px-7 py-8">
      <div className="mb-4 text-base font-semibold text-ink">
        {isDrill ? "Разбор упражнения" : "Разбор разговора"}
      </div>

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
          <div className="mt-3 text-[16.5px] font-semibold text-ink">
            {emptyReason === "no-messages" ? "Разбирать нечего" : "Разбора нет"}
          </div>
          <p className="mt-1.5 text-pretty text-center text-[14.5px] leading-normal text-ink-subtle">
            {emptyReason === "no-messages"
              ? "В этом разговоре не прозвучало ни одной реплики — обычно так бывает, когда не поднялся микрофон. В статистику он не идёт."
              : "Оценка по этому разговору не появилась. Расшифровка на месте — её можно прочитать целиком."}
          </p>
        </div>
      ) : (
        <>
          {/* Исход — главное, что менеджер должен увидеть первым:
              оценки отвечают «как ты работал», исход — «получилось или нет».
              У разборов старше механизма исхода нет вовсе, и тогда плашки
              просто не будет: это не третье состояние, а её отсутствие */}
          {isDrill ? (
            <DrillStamp passed={review.drillPassed as boolean} />
          ) : (
            review.outcome && <OutcomeStamp outcome={review.outcome} />
          )}

          <div className="rounded-xl border border-line p-[18px]">
            <div className="flex items-center gap-3.5">
              <ScoreRing score={review.overallScore} />
              <div>
                <div className="text-sm font-semibold text-ink">
                  {isDrill ? "Оценка за упражнение" : "Общая оценка"}
                </div>
                <div className="text-[14px] text-ink-subtle">{ringCaption}</div>
              </div>
            </div>

            {checklist && isDrill ? (
              <DrillChecklist
                stage={checklist[0]}
                messages={messages}
                startedAt={startedAt}
                onShow={onShowMessage}
              />
            ) : checklist ? (
              <ConversationChecklist
                stages={checklist}
                messages={messages}
                startedAt={startedAt}
                onShow={onShowMessage}
              />
            ) : (
              <LegacyStages review={review} />
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            <div className="rounded-lg border border-line border-l-[3px] border-l-brand px-3.5 py-3">
              <div className="text-xs font-semibold text-brand-hover">
                Сильное место
              </div>
              <p className="mt-1 text-[14.5px] leading-snug text-ink-label">
                {review.strength}
              </p>
            </div>
            <div className="rounded-lg border border-line border-l-[3px] border-l-warn px-3.5 py-3">
              <div className="text-xs font-semibold text-warn">Точка роста</div>
              <p className="mt-1 text-[14.5px] leading-snug text-ink-label">
                {review.growthPoint}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
