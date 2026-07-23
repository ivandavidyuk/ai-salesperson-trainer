"use client";

// Раздел «Тренировка»: витрина форматов практики — полный разговор,
// отдельные этапы сделки и спецнавык. Каждая карточка открывает мастер
// настройки с уже выбранным типом.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import AppShell from "@/app/components/AppShell";
import Spinner from "@/app/components/Spinner";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import { GROUP_LABELS, type WizardTrainingType } from "@/lib/training";

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
  s2: (
    <>
      <path d="M9 11.5a3 3 0 116 0c0 2-3 2.5-3 4" />
      <path d="M12 18.5h.01" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  s3: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
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
function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <div className="font-mono text-[11px] uppercase tracking-[.12em] text-brand-hover">
        {children}
      </div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function SoonBadge() {
  return (
    <span className="rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-ink-subtle">
      скоро
    </span>
  );
}

export default function TrainingPage() {
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
      <div className="mx-auto w-full max-w-[1440px] px-10 pb-11 pt-[26px]">
        <div className="mb-1.5 text-[21px] font-semibold tracking-[-.01em] text-ink">
          Выберите формат
        </div>
        <p className="mb-6 text-sm text-ink-muted">
          Пройдите разговор целиком или отработайте отдельный этап — на
          следующем шаге выберете пациента
        </p>

        {!types && !error && (
          <div className="flex justify-center py-16 text-ink-muted">
            <Spinner />
          </div>
        )}

        {error && (
          <p className="py-16 text-center text-sm text-danger-text">{error}</p>
        )}

        <div className="flex flex-col gap-[30px]">
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
            <div>
              <SectionTitle>{GROUP_LABELS.stage}</SectionTitle>
              <div className="flex flex-wrap gap-4">
                {byGroup.stage.map((type, index) => (
                  <StageCard
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
              <div className="flex flex-col gap-4">
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
  const blocked = !type.isActive;

  return (
    <div className="flex items-center gap-6 rounded-2xl bg-gradient-to-br from-brand to-brand-hover px-7 py-[26px] text-white shadow-[0_18px_40px_-22px_rgba(10,95,85,.7)]">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/[.14]">
        <Icon size={30}>
          <path d="M4 5.5a1.5 1.5 0 011.5-1.5H8l1.5 4-2 1.4a12 12 0 005.6 5.6l1.4-2 4 1.5V18a1.5 1.5 0 01-1.5 1.5A15 15 0 014 5.5z" />
        </Icon>
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[21px] font-bold">{type.title}</div>
        <p className="mt-1.5 max-w-[560px] text-pretty text-[14.5px] leading-normal text-white/[.86]">
          {type.description}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {["4 этапа", "60 мин", "Оценка по итогам"].map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-white/[.16] px-3 py-[5px] text-xs font-semibold"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={blocked}
        className={`flex shrink-0 items-center gap-2 rounded-xl px-[30px] py-3.5 text-[15px] font-bold transition-colors ${
          blocked
            ? "cursor-not-allowed bg-white/40 text-white/80"
            : "bg-white text-brand-hover hover:bg-brand-panel-meta"
        }`}
      >
        {blocked ? (
          "Скоро"
        ) : (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-brand-hover" />
            Начать
          </>
        )}
      </button>
    </div>
  );
}

// Этап сделки — одна из четырёх карточек в ряду
function StageCard({
  type,
  number,
  onStart,
}: CardProps & { number: number }) {
  const blocked = !type.isActive;

  return (
    // Четыре колонки при gap-4: (100% − 3 × 16px) / 4
    <div className="flex w-[calc((100%-48px)/4)] flex-col rounded-[14px] border border-line bg-surface-card p-5">
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-surface-accent text-brand">
          <Icon>{STAGE_ICONS[type.id] ?? FALLBACK_ICON}</Icon>
        </span>
        <div className="flex items-center gap-2">
          {blocked && <SoonBadge />}
          <span className="font-mono text-[13px] font-medium text-ink-placeholder">
            {String(number).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="mt-4 text-pretty text-[15.5px] font-semibold leading-tight text-ink">
        {type.title}
      </div>
      {/* flex-1 выравнивает кнопки по низу при описаниях разной длины */}
      <p className="mt-1.5 flex-1 text-pretty text-[13px] leading-normal text-ink-muted">
        {type.description}
      </p>

      <button
        type="button"
        onClick={onStart}
        disabled={blocked}
        className={`mt-[18px] flex items-center justify-center gap-2 rounded-input py-[11px] text-[14.5px] font-semibold text-white transition-colors ${
          blocked
            ? "cursor-not-allowed bg-disabled"
            : "bg-brand hover:bg-brand-hover"
        }`}
      >
        {blocked ? (
          "Скоро"
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
  const blocked = !type.isActive;

  return (
    <div className="flex items-center gap-[22px] rounded-[14px] border border-line bg-surface-card px-6 py-[22px]">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-warn-surface text-warn">
        <Icon size={27}>
          <path d="M13 2L4.5 13H11l-1 9 8.5-11H12z" />
        </Icon>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-[17px] font-semibold text-ink">{type.title}</div>
          {blocked && <SoonBadge />}
        </div>
        <p className="mt-1 max-w-[620px] text-pretty text-[13.5px] leading-normal text-ink-muted">
          {type.description}
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={blocked}
        className={`flex shrink-0 items-center gap-2 rounded-input px-7 py-[13px] text-[15px] font-semibold text-white transition-colors ${
          blocked
            ? "cursor-not-allowed bg-disabled"
            : "bg-brand hover:bg-brand-hover"
        }`}
      >
        {blocked ? (
          "Скоро"
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
