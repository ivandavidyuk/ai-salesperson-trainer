"use client";

// Раздел «Тренировка»: витрина форматов практики — полный разговор,
// отдельные этапы сделки и спецнавык. Каждая карточка открывает мастер
// настройки с уже выбранным типом.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AppShell from "@/app/components/AppShell";
import Loader from "@/app/components/Loader";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import { useWords } from "@/app/components/IndustryProvider";
import {
  GROUP_LABELS,
  ЗАМОК_БЕЙДЖ,
  ЗАМОК_КНОПКА,
  замок,
  type Замок,
  type WizardTrainingType,
} from "@/lib/training";

// Иконки этапов из макета. Ключ — id типа в базе; для типа, которого здесь
// нет, берётся запасная иконка, иначе новый тип уронил бы страницу.
const STAGE_ICONS: Record<string, ReactNode> = {
  s1: (
    <>
      <path d="M8 12h8" />
      <path d="M12 8v8" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  // Знак вопроса центрируем по окружности: прежний глиф был смещён вниз,
  // и точка почти касалась круга
  s2: (
    <>
      <path d="M9.4 10a2.6 2.6 0 115.2 0c0 1.8-2.6 2.2-2.6 3.9" />
      <path d="M12 16.8h.01" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  s3: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  // Реплика, сказанная вперёд: облако с двойным шевроном — «говорю раньше,
  // чем спросят». Щит с галочкой остаётся у отработки: там защита от уже
  // прозвучавшего сомнения, здесь упреждение. Из макета
  prevention: (
    <>
      <path d="M4 6.6a2.1 2.1 0 012.1-2.1h11.8A2.1 2.1 0 0120 6.6v6.8a2.1 2.1 0 01-2.1 2.1h-6.6L7.2 19v-3.5H6.1A2.1 2.1 0 014 13.4z" />
      <path d="M9.4 7.9l2.2 2.1-2.2 2.1" />
      <path d="M13.4 7.9l2.2 2.1-2.2 2.1" />
    </>
  ),
  s4: (
    <>
      <path d="M12 3l7 3v5c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V6z" />
      <path d="M9.2 12l1.9 1.9 3.7-3.8" />
    </>
  ),
};

const FALLBACK_ICON = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>
);

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Заголовок секции: подпись и линия до конца строки
function SectionTitle({
  children,
  actions,
}: {
  children: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`mb-3 flex gap-2.5 max-md:mb-2.5 max-md:items-center ${actions ? "items-center" : "items-baseline"}`}
    >
      <div className="font-mono text-[12.5px] uppercase tracking-[.12em] text-brand-hover max-md:whitespace-nowrap max-md:text-[13px] max-md:tracking-[.1em]">
        {children}
      </div>
      <div className="h-px flex-1 bg-line" />
      {actions}
    </div>
  );
}

/**
 * Полоса этапов, как в макете: карточки по 288px в горизонтальной прокрутке
 * со снапом, счётчик и стрелки в заголовке секции.
 *
 * Ширина 288 выбрана дизайном не для красоты: при ней пятая карточка всегда
 * торчит краем и видно, что полоса продолжается. Без этого профилактика
 * возражений — новый этап, о котором менеджер ещё не знает, — уезжала бы
 * за край незамеченной.
 */
function StageCarousel({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);

  // Шаг — карточка плюс отступ (288 + 16), как в макете
  const scrollBy = (direction: 1 | -1) =>
    track.current?.scrollBy({ left: direction * 304, behavior: "smooth" });

  return (
    <div className="max-md:hidden">
      <SectionTitle
        actions={
          <>
            <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] text-ink-placeholder">
              {count} этапов · листайте
            </span>
            <CarouselArrow direction="prev" onClick={() => scrollBy(-1)} />
            <CarouselArrow direction="next" onClick={() => scrollBy(1)} />
          </>
        }
      >
        {title}
      </SectionTitle>
      <div
        ref={track}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </div>
  );
}

function CarouselArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Предыдущие этапы" : "Следующие этапы"}
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-card text-ink-muted transition-colors hover:bg-surface-bubble"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "prev" ? (
          <path d="M14.5 6l-6 6 6 6" />
        ) : (
          <path d="M9.5 6l6 6-6 6" />
        )}
      </svg>
    </button>
  );
}

function SoonBadge({ причина }: { причина: "скоро" | "демо" }) {
  return (
    <span className="rounded-full bg-surface px-2 py-0.5 text-[12px] font-semibold text-ink-subtle">
      {ЗАМОК_БЕЙДЖ[причина]}
    </span>
  );
}

export default function TrainingPage() {
  const слова = useWords();
  const [types, setTypes] = useState<WizardTrainingType[] | null>(null);
  const [error, setError] = useState("");
  const [started, setStarted] = useState<WizardTrainingType | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/training-types");
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as WizardTrainingType[];
        if (!cancelled) setTypes(data);
      } catch {
        if (!cancelled) setError("Не удалось загрузить типы тренировки");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byGroup = useMemo(
    () => ({
      full: (types ?? []).filter((type) => type.group === "full"),
      stage: (types ?? []).filter((type) => type.group === "stage"),
      special: (types ?? []).filter((type) => type.group === "special"),
    }),
    [types]
  );

  return (
    <AppShell title="Тренировка">
      <div className="mx-auto w-full max-w-[1760px] px-10 pb-11 pt-[26px] max-md:px-4 max-md:pb-6 max-md:pt-[18px]">
        {/* На телефоне название раздела уже в шапке — как в макете,
            сразу секции */}
        <div className="mb-1.5 text-[22.5px] font-semibold tracking-[-.01em] text-ink max-md:hidden">
          Выберите формат
        </div>
        <p className="mb-6 text-sm text-ink-muted max-md:hidden">
          Пройдите разговор целиком или отработайте отдельный этап — на
          следующем шаге выберете {слова.клиента}
        </p>

        {!types && !error && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}

        {error && (
          <p className="py-16 text-center text-sm text-danger-text">{error}</p>
        )}

        <div className="flex flex-col gap-[30px] max-md:gap-6">
          {/* Пустые группы не рисуем — заголовок над пустотой выглядел бы
              как сломанная вёрстка */}
          {byGroup.full.length > 0 && (
            <div>
              <SectionTitle>{GROUP_LABELS.full}</SectionTitle>
              {byGroup.full.map((type) => (
                <FullCard
                  key={type.id}
                  type={type}
                  onStart={() => setStarted(type)}
                />
              ))}
            </div>
          )}

          {byGroup.stage.length > 0 && (
            <StageCarousel
              title={GROUP_LABELS.stage}
              count={byGroup.stage.length}
            >
              {byGroup.stage.map((type, index) => (
                <StageCard
                  key={type.id}
                  type={type}
                  number={index + 1}
                  onStart={() => setStarted(type)}
                />
              ))}
            </StageCarousel>
          )}

          {byGroup.stage.length > 0 && (
            <div className="md:hidden">
              <SectionTitle>{GROUP_LABELS.stage}</SectionTitle>
              <div className="overflow-hidden rounded-2xl border border-line bg-surface-card">
                {byGroup.stage.map((type, index) => (
                  <StageRow
                    key={type.id}
                    type={type}
                    number={index + 1}
                    onStart={() => setStarted(type)}
                  />
                ))}
              </div>
            </div>
          )}

          {byGroup.special.length > 0 && (
            <div>
              <SectionTitle>{GROUP_LABELS.special}</SectionTitle>
              <div className="flex flex-col gap-4 max-md:gap-2.5">
                {byGroup.special.map((type) => (
                  <SpecialCard
                    key={type.id}
                    type={type}
                    onStart={() => setStarted(type)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {started && (
        <TrainingSetupModal
          presetType={started}
          onClose={() => setStarted(null)}
        />
      )}
    </AppShell>
  );
}

interface CardProps {
  type: WizardTrainingType;
  onStart: () => void;
}

// Полный разговор — главный формат, поэтому широкая тиловая карточка
function FullCard({ type, onStart }: CardProps) {
  const закрыт: Замок = замок(type);
  const blocked = закрыт !== null;

  const icon = (
    <Icon size={30}>
      <path d="M4 5.5a1.5 1.5 0 011.5-1.5H8l1.5 4-2 1.4a12 12 0 005.6 5.6l1.4-2 4 1.5V18a1.5 1.5 0 01-1.5 1.5A15 15 0 014 5.5z" />
    </Icon>
  );
  const chips = (
    <div className="mt-3.5 flex flex-wrap gap-2 max-md:mt-0">
      {["4 этапа", "60 мин", "Оценка по итогам"].map((chip) => (
        <span
          key={chip}
          className="rounded-full bg-white/[.16] px-3 py-[5px] text-xs font-semibold max-md:text-[13px]"
        >
          {chip}
        </span>
      ))}
    </div>
  );
  const button = (
    <button
      type="button"
      onClick={onStart}
      disabled={blocked}
      className={`flex shrink-0 items-center gap-2 rounded-xl px-[30px] py-3.5 text-[16.5px] font-bold transition-colors max-md:min-h-[52px] max-md:w-full max-md:justify-center max-md:py-0 max-md:text-[16px] max-md:font-semibold ${
        blocked
          ? "cursor-not-allowed bg-white/40 text-white/80"
          : "bg-white text-brand-hover hover:bg-brand-panel-meta"
      }`}
    >
      {закрыт ? (
        ЗАМОК_КНОПКА[закрыт]
      ) : (
        <>
          <span className="inline-block h-2 w-2 rounded-full bg-brand-hover" />
          Начать
        </>
      )}
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-6 rounded-2xl bg-gradient-to-br from-brand to-brand-hover px-7 py-[26px] text-white shadow-[0_18px_40px_-22px_rgba(10,95,85,.7)] max-md:hidden">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/[.14]">
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[22.5px] font-bold">{type.title}</div>
          <p className="mt-1.5 max-w-[560px] text-pretty text-[16px] leading-normal text-white/[.86]">
            {type.description}
          </p>
          {chips}
        </div>

        {button}
      </div>

      {/* Телефон: значок с названием в строку, под ними описание, плашки
          и кнопка во всю ширину */}
      <div className="flex flex-col gap-3.5 rounded-2xl bg-gradient-to-br from-brand to-brand-hover p-5 text-white shadow-[0_18px_40px_-22px_rgba(10,95,85,.7)] md:hidden">
        <div className="flex items-center gap-3.5">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] bg-white/[.14]">
            {icon}
          </span>
          <div className="text-[20px] font-bold">{type.title}</div>
        </div>
        <p className="text-pretty text-[15px] leading-normal text-white/[.88]">
          {type.description}
        </p>
        {chips}
        {button}
      </div>
    </>
  );
}

// Этап на телефоне — строка списка: значок, номер с названием и описание,
// кнопка справа. Карусель 288-пиксельных карточек на 390 px показала бы
// одну карточку и край следующей — список читается целиком
function StageRow({
  type,
  number,
  onStart,
}: CardProps & { number: number }) {
  const закрыт: Замок = замок(type);
  const blocked = закрыт !== null;

  return (
    <div className="flex items-center gap-3 border-t border-line-soft p-3.5 first:border-t-0">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-surface-accent text-brand">
        <Icon>{STAGE_ICONS[type.id] ?? FALLBACK_ICON}</Icon>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] text-ink-placeholder">
            {String(number).padStart(2, "0")}
          </span>
          <span className="text-[16px] font-semibold leading-[1.3] text-ink">
            {type.title}
          </span>
        </div>
        {закрыт && (
          <div className="mt-1">
            <SoonBadge причина={закрыт} />
          </div>
        )}
        <p className="mt-[3px] text-pretty text-[14px] leading-[1.45] text-ink-muted">
          {type.description}
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={blocked}
        className={`inline-flex min-h-11 shrink-0 items-center gap-[7px] rounded-[10px] px-3.5 text-[15px] font-semibold text-white ${
          blocked ? "cursor-not-allowed bg-disabled" : "bg-brand active:bg-brand-hover"
        }`}
      >
        {закрыт ? (
          ЗАМОК_КНОПКА[закрыт]
        ) : (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-white" />
            Начать
          </>
        )}
      </button>
    </div>
  );
}

// Этап сделки — карточка в горизонтальной полосе. Ширина 288 из макета:
// при ней пятая карточка торчит краем и полоса читается как продолжающаяся
function StageCard({
  type,
  number,
  onStart,
}: CardProps & { number: number }) {
  const закрыт: Замок = замок(type);
  const blocked = закрыт !== null;

  return (
    <div className="flex w-[288px] shrink-0 snap-start flex-col rounded-[14px] border border-line bg-surface-card p-5">
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-surface-accent text-brand">
          <Icon>{STAGE_ICONS[type.id] ?? FALLBACK_ICON}</Icon>
        </span>
        <div className="flex items-center gap-2">
          {закрыт && <SoonBadge причина={закрыт} />}
          <span className="font-mono text-[14.5px] font-medium text-ink-placeholder">
            {String(number).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="mt-4 text-pretty text-[17px] font-semibold leading-tight text-ink">
        {type.title}
      </div>
      {/* flex-1 выравнивает кнопки по низу при описаниях разной длины */}
      <p className="mt-1.5 flex-1 text-pretty text-[14.5px] leading-normal text-ink-muted">
        {type.description}
      </p>

      <button
        type="button"
        onClick={onStart}
        disabled={blocked}
        className={`mt-[18px] flex items-center justify-center gap-2 rounded-input py-[11px] text-[16px] font-semibold text-white transition-colors ${
          blocked
            ? "cursor-not-allowed bg-disabled"
            : "bg-brand hover:bg-brand-hover"
        }`}
      >
        {закрыт ? (
          ЗАМОК_КНОПКА[закрыт]
        ) : (
          <>
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-white" />
            Начать
          </>
        )}
      </button>
    </div>
  );
}

// Спецнавык — широкая карточка с янтарной иконкой
function SpecialCard({ type, onStart }: CardProps) {
  const закрыт: Замок = замок(type);
  const blocked = закрыт !== null;

  const icon = (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-warn-surface text-warn max-md:h-[52px] max-md:w-[52px]">
      <Icon size={27}>
        <path d="M13 2L4.5 13H11l-1 9 8.5-11H12z" />
      </Icon>
    </span>
  );
  const title = (
    <div className="flex items-center gap-2 max-md:flex-wrap">
      <div className="text-[18.5px] font-semibold text-ink max-md:text-[18px]">{type.title}</div>
      {закрыт && <SoonBadge причина={закрыт} />}
    </div>
  );
  const button = (
    <button
      type="button"
      onClick={onStart}
      disabled={blocked}
      className={`flex shrink-0 items-center gap-2 rounded-input px-7 py-[13px] text-[16.5px] font-semibold text-white transition-colors max-md:min-h-[52px] max-md:w-full max-md:justify-center max-md:rounded-xl max-md:py-0 max-md:text-[16px] ${
        blocked
          ? "cursor-not-allowed bg-disabled"
          : "bg-brand hover:bg-brand-hover"
      }`}
    >
      {закрыт ? (
        ЗАМОК_КНОПКА[закрыт]
      ) : (
        <>
          <span className="inline-block h-2 w-2 rounded-full bg-white" />
          Начать
        </>
      )}
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-[22px] rounded-[14px] border border-line bg-surface-card px-6 py-[22px] max-md:hidden">
        {icon}

        <div className="min-w-0 flex-1">
          {title}
          <p className="mt-1 max-w-[620px] text-pretty text-[15px] leading-normal text-ink-muted">
            {type.description}
          </p>
        </div>

        {button}
      </div>

      {/* Телефон — тем же складом, что полный разговор: значок с названием,
          описание, кнопка во всю ширину */}
      <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface-card p-5 md:hidden">
        <div className="flex items-center gap-3.5">
          {icon}
          {title}
        </div>
        <p className="text-pretty text-[15px] leading-normal text-ink-muted">
          {type.description}
        </p>
        {button}
      </div>
    </>
  );
}
