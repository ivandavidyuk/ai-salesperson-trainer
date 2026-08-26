"use client";

// Окно «Демо-доступ завершён» — то, что видит демо-пара вместо мастера
// настройки, когда сутки вышли или сгорел тихий потолок часов.
//
// Текст один на оба случая, и это осознанно: потолок — аварийный
// предохранитель, клиенту о нём не говорим, поэтому его срабатывание
// неотличимо от конца суток. В отличие от HoursExhaustedModal здесь
// нет ни одного числа — ни остатка, ни лимита, ни даты сброса.
//
// Контакта в тексте тоже нет: клиента ведёт Дима лично и напишет сам.

interface DemoExpiredModalProps {
  onClose: () => void;
}

export default function DemoExpiredModal({ onClose }: DemoExpiredModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10">
      <div className="w-[520px] rounded-[18px] bg-surface-card px-8 pb-[26px] pt-[30px] shadow-2xl">
        <div className="flex items-center gap-3.5">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[18px] font-bold text-brand">
            ✓
          </div>
          <div className="text-[19px] font-semibold text-ink">
            Демо-доступ завершён
          </div>
        </div>

        <p className="mt-4 text-[14px] leading-relaxed text-ink-body">
          Спасибо, что попробовали тренажёр. Новые разговоры в демо-режиме
          закрыты, но расшифровки и разборы остаются доступны ещё несколько
          дней — их можно пересматривать и показать коллегам.
        </p>

        <div className="mt-[18px] rounded-[11px] border border-line-soft bg-surface px-[15px] py-3 text-[13px] leading-normal text-ink-muted">
          Чтобы команда продолжила тренироваться на полном доступе — напишите
          нам.
        </div>

        <div className="mt-[22px] flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-line-strong bg-surface-card px-5 py-[11px] text-[14px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
          >
            Понятно
          </button>
          <a
            href="/"
            className="inline-flex items-center rounded-[10px] bg-brand px-[22px] py-[11px] text-[14px] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Посмотреть разборы
          </a>
        </div>
      </div>
    </div>
  );
}
