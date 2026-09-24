"use client";

// Окно «Демо-доступ завершён» — то, что видит демо вместо мастера настройки,
// когда кончились сутки, разговоры или сгорел тихий потолок часов.
//
// Текст один на все случаи, и это осознанно: потолок — аварийный
// предохранитель, клиенту о нём не говорим, поэтому его срабатывание
// неотличимо от конца доступа. В отличие от HoursExhaustedModal здесь
// нет ни одного числа — ни остатка, ни лимита, ни даты сброса.
//
// Кнопка одна. Вторая, «Посмотреть разборы», вела на «/» — то есть на ту же
// главную, где окно и показывается: страница перезагружалась, окно вставало
// заново, и человек решал, что оно сломано. Дорогу к разборам объясняем
// словами: они открываются из списка разговоров на главной, за этим окном.

import Sheet, { SHEET_PRIMARY, SheetIcon } from "@/app/components/Sheet";

const TELEGRAM = "https://t.me/kimpodhod";

interface DemoExpiredModalProps {
  onClose: () => void;
}

export default function DemoExpiredModal({ onClose }: DemoExpiredModalProps) {
  // Текст один для карточки на компьютере и листа на телефоне
  const текст = (
    <p className="mt-4 text-[15.5px] leading-relaxed text-ink-body max-md:mt-0 max-md:text-[15px]">
      Спасибо, что попробовали тренажёр. Новые разговоры в демо-режиме
      закрыты, а расшифровки и разборы остаются ещё несколько дней: чтобы
      перечитать разбор, откройте разговор в разделе «Прошлые разговоры»
      на главной.
    </p>
  );
  const связь = (
    <div className="mt-[18px] rounded-[11px] border border-line-soft bg-surface px-[15px] py-3 text-[14.5px] leading-normal text-ink-muted max-md:mt-3.5 max-md:rounded-xl max-md:px-4 max-md:py-3.5 max-md:text-[15px]">
      Чтобы команда продолжила тренироваться на полном доступе — напишите
      Дмитрию в Telegram:{" "}
      <a
        href={TELEGRAM}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand hover:underline"
      >
        t.me/kimpodhod
      </a>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10 max-md:hidden">
        <div className="w-[520px] rounded-[18px] bg-surface-card px-8 pb-[26px] pt-[30px] shadow-2xl">
          <div className="flex items-center gap-3.5">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[19.5px] font-bold text-brand">
              ✓
            </div>
            <div className="text-[20.5px] font-semibold text-ink">
              Демо-доступ завершён
            </div>
          </div>

          {текст}
          {связь}

          <div className="mt-[22px] flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] bg-brand px-[22px] py-[11px] text-[15.5px] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              Понятно
            </button>
          </div>
        </div>
      </div>

      <Sheet
        className="md:hidden"
        title="Демо-доступ завершён"
        icon={<SheetIcon tone="brand">✓</SheetIcon>}
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose} className={SHEET_PRIMARY}>
            Понятно
          </button>
        }
      >
        {текст}
        {связь}
      </Sheet>
    </>
  );
}
