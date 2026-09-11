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

const TELEGRAM = "https://t.me/kimpodhod";

interface DemoExpiredModalProps {
  onClose: () => void;
}

export default function DemoExpiredModal({ onClose }: DemoExpiredModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10">
      <div className="w-[520px] rounded-[18px] bg-surface-card px-8 pb-[26px] pt-[30px] shadow-2xl">
        <div className="flex items-center gap-3.5">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[19.5px] font-bold text-brand">
            ✓
          </div>
          <div className="text-[20.5px] font-semibold text-ink">
            Демо-доступ завершён
          </div>
        </div>

        <p className="mt-4 text-[15.5px] leading-relaxed text-ink-body">
          Спасибо, что попробовали тренажёр. Новые разговоры в демо-режиме
          закрыты, а расшифровки и разборы остаются ещё несколько дней: чтобы
          перечитать разбор, откройте разговор в разделе «Прошлые разговоры»
          на главной.
        </p>

        <div className="mt-[18px] rounded-[11px] border border-line-soft bg-surface px-[15px] py-3 text-[14.5px] leading-normal text-ink-muted">
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
  );
}
