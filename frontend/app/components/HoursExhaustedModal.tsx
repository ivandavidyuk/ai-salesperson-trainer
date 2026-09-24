"use client";

// Окно «Часы разговоров закончились» — то, что видит менеджер вместо мастера
// настройки, когда отдел израсходовал месячный лимит.
//
// Показывается ВМЕСТО мастера, а не поверх него: человек нажал «начать
// тренировку», и честный ответ на это нажатие — «нельзя и вот почему»,
// а не форма, которая всё равно упрётся в отказ на последнем шаге.

import { plural } from "@/lib/format";
import { useWords } from "@/app/components/IndustryProvider";
import Sheet, {
  SHEET_PRIMARY,
  SHEET_SECONDARY,
  SheetIcon,
} from "@/app/components/Sheet";

interface HoursExhaustedModalProps {
  /** Когда лимит обновится, ISO */
  resetsAt: string;
  /** Часов в месяц по тарифу */
  limitHours: number;
  onClose: () => void;
}

export default function HoursExhaustedModal({
  resetsAt,
  limitHours,
  onClose,
}: HoursExhaustedModalProps) {
  const слова = useWords();
  const обновится = new Date(resetsAt).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });

  // Текст один для карточки на компьютере и листа на телефоне
  const текст = (
    <p className="mt-4 text-[15.5px] leading-relaxed text-ink-body max-md:mt-0 max-md:text-[15px]">
      {слова.Организация} израсходовала месячный лимит —{" "}
      {limitHours} {plural(limitHours, "час", "часа", "часов")} на весь отдел. Новые
      разговоры не начнутся до {обновится}: тогда лимит обновится сам.
    </p>
  );
  const пояснение = (
    <div className="mt-[18px] rounded-[11px] border border-line-soft bg-surface px-[15px] py-3 text-[14.5px] leading-normal text-ink-muted max-md:mt-3.5 max-md:rounded-xl max-md:px-4 max-md:py-3.5 max-md:text-[15px]">
      Разбор часов не тратит: расшифровки прошлых разговоров и задания
      открыты.
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10 max-md:hidden">
        <div className="w-[520px] rounded-[18px] bg-surface-card px-8 pb-[26px] pt-[30px] shadow-2xl">
          <div className="flex items-center gap-3.5">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-danger-wash text-[21.5px] font-bold text-danger-strong">
              !
            </div>
            <div className="text-[20.5px] font-semibold text-ink">
              Часы разговоров закончились
            </div>
          </div>

          {текст}
          {пояснение}

          <div className="mt-[22px] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-line-strong bg-surface-card px-5 py-[11px] text-[15.5px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
            >
              Закрыть
            </button>
            <a
              href="/tasks"
              className="inline-flex items-center rounded-[10px] bg-brand px-[22px] py-[11px] text-[15.5px] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              Открыть задания
            </a>
          </div>
        </div>
      </div>

      {/* На телефоне кнопки друг под другом, главная — сверху */}
      <Sheet
        className="md:hidden"
        title="Часы разговоров закончились"
        icon={<SheetIcon tone="danger">!</SheetIcon>}
        onClose={onClose}
        footer={
          <>
            <a href="/tasks" className={SHEET_PRIMARY}>
              Открыть задания
            </a>
            <button type="button" onClick={onClose} className={SHEET_SECONDARY}>
              Закрыть
            </button>
          </>
        }
      >
        {текст}
        {пояснение}
      </Sheet>
    </>
  );
}
