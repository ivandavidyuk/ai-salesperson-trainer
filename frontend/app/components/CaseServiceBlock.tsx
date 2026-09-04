// Блок «Услуга по диагнозу» рядом с документом диагностики.
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

import { SERVICE_NOT_MATCHED, type CaseService } from "@/lib/caseService";

interface CaseServiceBlockProps {
  service: CaseService | null;
  /**
   * card — на экране звонка: единственный залитый прямоугольник в карточке,
   * менеджер читает его первым, пока пациент «ходит к врачу».
   * line — в расшифровке: одна тихая строка над документом. Разговор прошёл,
   * там услуга — контекст, а не подсказка, и подсвечивать её нечестно.
   */
  variant: "card" | "line";
}

export default function CaseServiceBlock({ service, variant }: CaseServiceBlockProps) {
  if (variant === "line") {
    return (
      <p className="mb-3 text-xs leading-snug text-ink-label">
        Услуга по диагнозу:{" "}
        {service ? (
          <>
            <span className="font-semibold text-ink">{service.name}</span>,{" "}
            <span className="font-mono text-xs">{service.price}</span> — из прайса клиники.
          </>
        ) : (
          <span>{SERVICE_NOT_MATCHED.replace(/\.$/, "").toLowerCase()}.</span>
        )}
      </p>
    );
  }

  if (!service) {
    // Тот же блок того же размера, заливка на пунктир и одна фраза.
    // Ни жёлтого, ни красного: это не сбой, а честный ответ прайса
    return (
      <div className="rounded-[10px] border border-dashed border-line-strong bg-surface px-[15px] py-[13px]">
        <div className="text-xs font-medium uppercase tracking-[.1em] text-ink-subtle">
          Услуга по диагнозу
        </div>
        <div className="mt-1.5 text-sm leading-snug text-ink-label">{SERVICE_NOT_MATCHED}</div>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-line-accent bg-brand-on-muted px-[15px] py-[13px]">
      <div className="text-xs font-semibold uppercase tracking-[.1em] text-brand-hover">
        Услуга по диагнозу
      </div>
      <div className="mt-1.5 text-lg font-semibold leading-tight tracking-[-.01em] text-ink">
        {service.name}
      </div>
      <div className="mt-1.5 font-mono text-base font-medium text-brand-score">{service.price}</div>
      <div className="mt-1.5 text-xs text-ink-subtle">из прайса клиники</div>
    </div>
  );
}
