"use client";

// Карточка пациента: анамнез и уровень сложности.
// Открывается поверх мастера настройки тренировки по кнопке «О пациенте».

import { useEffect } from "react";
import { initials } from "@/lib/format";
import { DIFFICULTY, type WizardPatient } from "@/lib/training";

interface PatientInfoModalProps {
  patient: WizardPatient;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <p className="mt-1.5 text-pretty text-[13.5px] leading-normal text-ink-body">
        {children}
      </p>
    </div>
  );
}

export default function PatientInfoModal({
  patient,
  onClose,
}: PatientInfoModalProps) {
  // Escape закрывает только эту карточку: мастер под ней остаётся открытым.
  // Останавливаем всплытие, чтобы его обработчик не сработал следом.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const difficulty = DIFFICULTY[patient.difficulty];

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(12,26,24,.5)] p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`О пациенте: ${patient.name}`}
    >
      <div
        className="flex max-h-full w-[440px] max-w-full flex-col overflow-hidden rounded-2xl bg-surface-card shadow-[0_30px_80px_-30px_rgba(12,26,24,.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3.5 border-b border-line-soft px-6 py-[22px]">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[17px] font-semibold text-brand">
            {initials(patient.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold text-ink">{patient.name}</div>
            {patient.description && (
              <div className="mt-0.5 text-[13px] text-ink-subtle">
                {patient.description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-bubble text-base leading-none text-ink-muted transition-colors hover:bg-line"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-5">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
              Анамнез
            </div>
            <p className="mt-1.5 text-pretty text-sm leading-relaxed text-ink-body">
              {patient.anamnesis || "Анамнез пока не заполнен."}
            </p>
          </div>

          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
              Уровень сложности
            </div>
            <span
              className={`mt-2 inline-flex items-center gap-[7px] rounded-full px-3 py-[5px] text-xs font-semibold ${difficulty.pill}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${difficulty.dot}`} />
              {difficulty.label}
            </span>
          </div>

          {/* Разбор приходит только руководителю: у менеджера этих полей
              в ответе API нет, и блоки просто не рисуются */}
          {patient.character && (
            <Section title="Характер">{patient.character}</Section>
          )}

          {patient.objections && patient.objections.length > 0 && (
            <div>
              <SectionTitle>Особые возражения</SectionTitle>
              <div className="mt-2 flex flex-col gap-2">
                {patient.objections.map((objection) => (
                  <div key={objection} className="flex items-start gap-2.5">
                    <span className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-danger-strong" />
                    <span className="text-pretty text-[13.5px] leading-normal text-ink-body">
                      {objection}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {patient.decisionMaker && (
            <Section title="ЛПР · кто принимает решение">
              {patient.decisionMaker}
            </Section>
          )}

          {patient.approach && (
            <div className="rounded-xl border border-line-accent bg-surface-accent px-4 py-3.5">
              <div className="flex items-center gap-[7px] font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="15" r="4" />
                  <path d="M10.5 12.5L19 4" />
                  <path d="M16 7l2 2" />
                  <path d="M18 5l2 2" />
                </svg>
                Подход · как выиграть клиента
              </div>
              <p className="mt-[7px] text-pretty text-sm font-medium leading-normal text-ink">
                {patient.approach}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
