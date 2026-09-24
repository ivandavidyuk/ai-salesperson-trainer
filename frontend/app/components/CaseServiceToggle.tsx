"use client";

// Кнопка «Показать услугу» и окошко, которое она открывает, — на экране
// звонка в упражнениях, начинающихся с середины разговора.
//
// Окошко выезжает влево, в пустое поле рядом с колонкой, и потому ничего
// не перекрывает и не сдвигает. Модалка по центру гасила бы плашку «Говорит
// клиент» — единственный признак, что пациент ещё говорит, — и менеджер,
// читая цену, перебивал бы его. Строка внутри колонки уводила бы вниз
// «Завершить разговор», а промах мимо этой кнопки стоит дороже всех.
//
// Само не закрывается: ни по таймеру, ни по клику мимо, ни при смене
// говорящего. Держать цену перед глазами весь спор о деньгах — решение
// менеджера. Закрывают той же кнопкой, крестиком или Esc.
//
// Когда услуга не подобрана, кнопка остаётся той же и живой. Погашенная
// читалась бы как «не загрузилось», а знание «цены у меня нет» тоже нужно
// получить до того, как пациент спросит.

import { useEffect, useState } from "react";
import CaseServiceBlock from "@/app/components/CaseServiceBlock";
import Sheet from "@/app/components/Sheet";
import { useWords } from "@/app/components/IndustryProvider";
import type { CaseService } from "@/lib/caseService";

interface CaseServiceToggleProps {
  /** null — «услуга не подобрана» */
  service: CaseService | null;
  /** Телефонный вид: кнопка во всю ширину, услуга — листом снизу */
  phone?: boolean;
}

export default function CaseServiceToggle({ service, phone = false }: CaseServiceToggleProps) {
  const слова = useWords();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const поEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", поEscape);
    return () => document.removeEventListener("keydown", поEscape);
  }, [open]);

  if (phone) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-[9px] rounded-xl border border-line-strong bg-white px-5 text-[16px] font-semibold text-ink"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand"
          >
            <path d="M5 4h11l3 3v13H5z" />
            <path d="M9 12h6M9 16h4" />
          </svg>
          {слова.показатьУслугу}
        </button>
        {open && (
          <Sheet title={слова.услугаПоЗаявке} onClose={() => setOpen(false)}>
            <CaseServiceBlock service={service} variant="popover" />
          </Sheet>
        )}
      </>
    );
  }

  return (
    <div className="relative">
      {open && (
        <div className="absolute bottom-[-4px] right-[calc(100%+16px)] z-10 w-[280px] rounded-xl border border-line-accent bg-surface-card px-4 pb-4 pt-3.5 text-left shadow-[0_26px_60px_-22px_rgba(20,40,38,0.5)]">
          <div className="flex items-start justify-between gap-2.5">
            {/* Без услуги подпись теряет бирюзу: называть нечего */}
            <div
              className={`pt-0.5 font-mono text-[12.5px] font-semibold uppercase tracking-[.1em] ${
                service ? "text-brand-hover" : "text-ink-subtle"
              }`}
            >
              {слова.услугаПоЗаявке}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={слова.скрытьУслугу}
              className="flex shrink-0 text-ink-subtle transition-colors hover:text-ink"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          </div>
          <div className="mt-2.5">
            <CaseServiceBlock service={service} variant="popover" />
          </div>
          {/* Хвостик упирается в кнопку, которой окошко открыли: закрыть
              его очевидно тем же нажатием */}
          <div className="absolute bottom-[22px] right-[-7px] h-3 w-3 rotate-45 border-r border-t border-line-accent bg-surface-card" />
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`inline-flex items-center gap-[9px] rounded-input-lg border px-[26px] py-[15px] text-base font-semibold transition-colors ${
          open
            ? "border-brand bg-brand-on-muted text-brand-hover"
            : "border-line-strong bg-white text-ink hover:border-brand"
        }`}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={open ? undefined : "text-brand"}
        >
          <path d="M5 4h11l3 3v13H5z" />
          <path d="M9 12h6M9 16h4" />
        </svg>
        {open ? слова.скрытьУслугу : слова.показатьУслугу}
      </button>
    </div>
  );
}
