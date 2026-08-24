"use client";

// Окно «Подробнее»: та же карточка пациента, только без обрезки.
//
// Порядок и состав повторяют карточку буквально — кто, с чем, подробности,
// что делать, — и ярлыков нет ни там, ни здесь. Ярлык, которого нет
// в карточке и есть в окне, превращал бы окно во второй экран, а человек
// открыл его ради одного: увидеть абзац целиком.
//
// Открывается и со страницы «Пациенты», и поверх мастера настройки.

import { useEffect } from "react";
import PatientAvatar from "@/app/components/PatientAvatar";
import {
  DIFFICULTY,
  splitPatientSubtitle,
  type WizardPatient,
} from "@/lib/training";

interface PatientInfoModalProps {
  patient: WizardPatient;
  onClose: () => void;
  /**
   * Запуск тренировки прямо из окна. Окно — адрес многоточия из карточки,
   * то есть конец чтения, а не конец дела: без этой кнопки человек закрывал
   * бы окно и искал ту же карточку глазами.
   *
   * Нет её только там, где она бессмысленна, — поверх мастера настройки:
   * оттуда тренировка и так запускается.
   */
  onStart?: () => void;
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
  onStart,
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
  const { age, reason } = splitPatientSubtitle(patient.description);

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(12,26,24,.5)] p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`О пациенте: ${patient.name}`}
    >
      <div
        className="flex max-h-full w-[640px] max-w-full flex-col overflow-hidden rounded-[18px] bg-surface-card shadow-[0_30px_80px_-30px_rgba(12,26,24,.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Кто. Шапка и кнопки остаются на месте — прокручивается только тело */}
        <div className="flex shrink-0 items-start gap-4 px-7 pb-5 pt-[26px]">
          <PatientAvatar
            name={patient.name}
            className="h-14 w-14 bg-brand-soft text-[18px] font-semibold text-brand"
          />
          <div className="min-w-0 flex-1">
            <div className="text-pretty text-xl font-semibold tracking-[-.01em] text-ink">
              {patient.name}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {age && (
                <>
                  <span className="text-[13.5px] text-ink-subtle">{age}</span>
                  <span className="text-[13.5px] text-line-strong">·</span>
                </>
              )}
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-[11px] py-1 text-[11.5px] font-semibold ${difficulty.pill}`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${difficulty.dot}`}
                />
                {difficulty.label}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            aria-label="Закрыть"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-ink-icon transition-colors hover:bg-surface-bubble hover:text-ink-muted"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>

        <div className="h-px shrink-0 bg-line-soft" />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 pb-[26px] pt-[22px]">
          {/* С чем и подробности — те же два текста, что в карточке,
              но здесь анамнез виден целиком: ради этого окно и открывают */}
          <div>
            {reason && (
              <div className="text-pretty text-[19px] font-semibold leading-[1.35] text-ink">
                {reason}
              </div>
            )}
            <p
              className={`text-pretty text-[14.5px] leading-[1.65] text-ink-label ${
                reason ? "mt-3" : ""
              }`}
            >
              {patient.anamnesis || "Анамнез пока не заполнен."}
            </p>
          </div>

          {/* Разбор приходит только руководителю: у менеджера этих полей
              в ответе API нет, и блоки просто не рисуются. В макете окна их
              нет — он рисовался под менеджера, — но убрать их значило бы
              оставить руководителя без досье */}
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

        {/* Что делать */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-line-soft px-7 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-input border border-line-strong bg-surface-card px-5 py-[11px] text-[14.5px] font-medium text-ink transition-colors hover:border-brand hover:text-brand-hover"
          >
            Закрыть
          </button>

          {onStart && (
            <button
              type="button"
              onClick={onStart}
              disabled={!patient.isActive}
              title={
                patient.isActive
                  ? undefined
                  : "Для этого пациента ещё не готов промпт"
              }
              className={`flex items-center gap-2 rounded-input px-[22px] py-[11px] text-[15px] font-semibold text-white transition-colors ${
                patient.isActive
                  ? "bg-brand hover:bg-brand-hover"
                  : "cursor-not-allowed bg-disabled"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white" />
              {patient.isActive ? "Начать тренировку" : "Скоро"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
