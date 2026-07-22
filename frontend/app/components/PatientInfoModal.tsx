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
        </div>
      </div>
    </div>
  );
}
