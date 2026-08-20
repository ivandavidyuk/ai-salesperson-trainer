"use client";

// Карточка «Часы разговоров» в кабинете руководителя.
//
// Тариф клиники меряется часами в месяц. Без этой карточки руководитель узнал
// бы о конце лимита в тот момент, когда у менеджеров перестали начинаться
// разговоры, — и решил бы, что сломался тренажёр.

import { useEffect, useState } from "react";
import { formatHours } from "@/lib/format";

interface Hours {
  limitSec: number;
  usedSec: number;
  leftSec: number;
  resetsAt: string;
  exhausted: boolean;
}

// С какого остатка карточка желтеет.
//
// Два условия, а не одно: доля бережёт большие тарифы (на 600 часах десять
// процентов — это 60, и предупреждать раньше незачем), а абсолютный порог —
// маленькие (на 10 часах десять процентов это час, и предупреждение пришло бы
// вместе с концом). Срабатывает то, что наступит раньше.
const ДОЛЯ_НА_ИСХОДЕ = 0.1;
const ЧАСОВ_НА_ИСХОДЕ = 2 * 3600;

type Состояние = "ok" | "low" | "out";

function состояние(h: Hours): Состояние {
  if (h.exhausted) return "out";
  const порог = Math.max(h.limitSec * ДОЛЯ_НА_ИСХОДЕ, ЧАСОВ_НА_ИСХОДЕ);
  return h.leftSec <= порог ? "low" : "ok";
}

function датаОбновления(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

export function HoursCard() {
  const [hours, setHours] = useState<Hours | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/organization/hours");
        const data = res.ok ? ((await res.json()) as Hours | null) : null;
        if (!cancelled) setHours(data);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Пока не загрузилось — ничего: скелет карточки на полсекунды дёргает
  // страницу сильнее, чем её появление. Клиники нет — лимита тоже нет
  if (!loaded || !hours) return null;

  const вид = состояние(hours);
  const процент =
    hours.limitSec > 0 ? Math.round((hours.leftSec / hours.limitSec) * 100) : 0;
  const обновится = датаОбновления(hours.resetsAt);
  const лимитЧасов = Math.round(hours.limitSec / 3600);

  const числоЦвет = {
    ok: "text-ink",
    low: "text-warn",
    out: "text-danger-text",
  }[вид];
  const полосаЦвет = {
    ok: "bg-brand",
    low: "bg-warn",
    out: "bg-danger",
  }[вид];

  return (
    <div className="shrink-0 rounded-2xl border border-line bg-surface-card px-6 py-[22px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[15.5px] font-semibold text-ink">Часы разговоров</div>
          <p className="mt-1 max-w-[430px] text-[13px] leading-normal text-ink-muted">
            Час считается от старта разговора до его завершения — вместе
            с паузами и молчанием.
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-soft px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[.06em] text-brand-hover">
          Тариф · {лимитЧасов} ч в месяц
        </span>
      </div>

      <div className="mt-5 flex items-end gap-3">
        <span className={`font-mono text-[38px] leading-none ${числоЦвет}`}>
          {вид === "out" ? "0 ч" : formatHours(hours.leftSec)}
        </span>
        <span className="pb-1 text-[13px] text-ink-muted">
          {вид === "out" ? "новые разговоры не начинаются" : "осталось в этом месяце"}
        </span>
      </div>

      <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-surface-bubble">
        <div
          className={`h-full rounded-full ${полосаЦвет}`}
          style={{ width: `${Math.max(0, Math.min(100, процент))}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-3 font-mono text-[11.5px] text-ink-muted">
        <span>
          потрачено {formatHours(hours.usedSec)} из {лимитЧасов} ч
        </span>
        <span>обновится {обновится}</span>
      </div>

      {вид === "low" && (
        <div className="mt-4 rounded-[11px] border border-warn-border bg-warn-surface px-3.5 py-3 text-[13px] leading-normal text-warn">
          Часы на исходе. Когда они кончатся, новые разговоры перестанут
          начинаться у всего отдела — до {обновится}.
        </div>
      )}
      {вид === "out" && (
        <div className="mt-4 rounded-[11px] border border-danger-border bg-danger-surface px-3.5 py-3 text-[13px] leading-normal text-danger-text">
          Часы кончились. Начатый разговор доигрывается до конца, новый уже
          не начнётся. {обновится} лимит обновится — снова {лимитЧасов} ч.
        </div>
      )}
    </div>
  );
}
