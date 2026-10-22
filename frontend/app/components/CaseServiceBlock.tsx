"use client";

// Блок «Услуга по диагнозу» рядом с документом диагностики.
//
// У офиса продаж тот же блок зовётся «Предложение по заявке»: подписи —
// словами отрасли (lib/industryWords.ts). Виден он там только в упражнениях,
// по кнопке «Показать предложение»: документа диагностики у неклиник нет.
//
// Услуга живёт ОТДЕЛЬНО от текста документа, и это принцип, а не вёрстка:
// документ — находки врача, голые цифры, и он намеренно не знает прайса
// (backend отбраковывает документ, назвавший услугу, как вывод о продаже).
// Услуга — вывод для менеджера, поэтому стоит своим блоком над документом.
//
// Подпись «Услуга по диагнозу» называет связь, а не задачу: «Услуга для
// пациента» читалось бы так, будто ему уже назначили, «Что предлагать» —
// как указание. Строка «из прайса клиники» снимает последнее: это выписка
// из прайса, а не решение за менеджера.

import { составСписком, type CaseService } from "@/lib/caseService";
import { useWords } from "@/app/components/IndustryProvider";

interface CaseServiceBlockProps {
  service: CaseService | null;
  /**
   * card — на экране звонка: единственный залитый прямоугольник в карточке,
   * менеджер читает его первым, пока пациент «ходит к врачу».
   * popover — в окошке «Показать услугу» в упражнении: тот же блок, но без
   * подписи — она стоит в шапке окошка рядом с крестиком.
   * line — в расшифровке: одна тихая строка над документом. Разговор прошёл,
   * там услуга — контекст, а не подсказка, и подсвечивать её нечестно.
   */
  variant: "card" | "popover" | "line";
}

export default function CaseServiceBlock({ service, variant }: CaseServiceBlockProps) {
  const слова = useWords();
  if (variant === "line") {
    return (
      <p className="mb-3 text-xs leading-snug text-ink-label">
        {слова.услугаПоЗаявке}:{" "}
        {service ? (
          <>
            <span className="font-semibold text-ink">{service.name}</span>,{" "}
            <span className="font-mono text-xs">{service.price}</span> — {слова.изПрайса}.
          </>
        ) : (
          <span>{слова.нетПодходящей.replace(/\.$/, "").toLowerCase()}.</span>
        )}
      </p>
    );
  }

  const withLabel = variant === "card";

  if (!service) {
    // Тот же блок того же размера, заливка на пунктир и одна фраза.
    // Ни жёлтого, ни красного: это не сбой, а честный ответ прайса
    return (
      <div className="rounded-[10px] border border-dashed border-line-strong bg-surface px-[15px] py-[13px]">
        {withLabel && (
          <div className="mb-1.5 text-xs font-medium uppercase tracking-[.1em] text-ink-subtle">
            {слова.услугаПоЗаявке}
          </div>
        )}
        <div className="text-sm leading-snug text-ink-label">{слова.нетПодходящей}</div>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-line-accent bg-brand-on-muted px-[15px] py-[13px]">
      {withLabel && (
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-[.1em] text-brand-hover">
          {слова.услугаПоЗаявке}
        </div>
      )}
      <div className="text-lg font-semibold leading-tight tracking-[-.01em] text-ink">
        {service.name}
      </div>
      <div className="mt-1.5 font-mono text-base font-medium text-brand-score">{service.price}</div>
      {service.description && <ServiceContents description={service.description} />}
      <div className="mt-1.5 text-xs text-ink-subtle">{слова.изПрайса}</div>
    </div>
  );
}

/**
 * Что входит в услугу — под ценой. Курс без состава менеджер продавал
 * вслепую: «Курс при грыже», а что в нём, неизвестно (Jamaica, 22.10).
 * Перечень «что — сколько» — списком, прочее описание — как в прайсе
 */
function ServiceContents({ description }: { description: string }) {
  const слова = useWords();
  const пункты = составСписком(description);
  return (
    <div className="mt-2.5 border-t border-line-accent pt-2">
      <div className="mb-1 text-xs font-medium uppercase tracking-[.1em] text-ink-subtle">
        {слова.составУслуги}
      </div>
      {пункты ? (
        <ul className="flex flex-col gap-0.5 text-sm leading-snug text-ink">
          {пункты.map((пункт) => (
            <li key={пункт}>{пункт}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-snug text-ink-label">{description}</p>
      )}
    </div>
  );
}
