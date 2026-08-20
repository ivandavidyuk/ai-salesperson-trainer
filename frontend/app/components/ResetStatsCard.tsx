"use client";

// Карточка «Очистить статистику» в кабинете руководителя.
//
// Первые разговоры уходят на освоение: человек привыкает к микрофону, бросает
// на середине, пробует голос. Они портят его среднюю и место в подиуме,
// а показывать их клиенту нельзя.
//
// Обнуление мягкое: разговоры и разборы остаются в базе, меняется только
// отметка, от которой считается статистика. Поэтому шаг подтверждения один,
// а не два экрана предупреждений: цена ошибки — одно нажатие «Вернуть».

import { useCallback, useEffect, useState } from "react";
import Button from "@/app/components/Button";
import { initials, plural } from "@/lib/format";

interface Manager {
  id: string;
  name: string;
  jobTitle: string;
  total: number;
  avgScore: number | null;
  statsResetAt: string | null;
}

function разговоров(n: number): string {
  return `${n} ${plural(n, "разговор", "разговора", "разговоров")}`;
}

function дата(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function ResetStatsCard() {
  const [open, setOpen] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/team/stats");
    if (!res.ok) return;
    setManagers((await res.json()) as Manager[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function обнулить(id: string, вернуть: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/team/${id}/reset-stats`, {
        method: вернуть ? "DELETE" : "POST",
      });
      await load();
      if (!вернуть) setOpen(false);
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  // Отдела нет — обнулять некого, и карточка бы только занимала место
  if (managers.length === 0) return null;

  const выбранный = managers.find((m) => m.id === picked) ?? null;
  const обнулённые = managers.filter((m) => m.statsResetAt);

  return (
    <>
      <div className="rounded-2xl border border-line bg-surface-card px-6 py-[22px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15.5px] font-semibold text-ink">Статистика отдела</div>
            <p className="mt-1 max-w-[420px] text-[13px] leading-normal text-ink-muted">
              Вы можете очистить статистику менеджеров вашего отдела. Это может
              быть необходимо в случае замены менеджера
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setOpen(true);
            }}
            className="shrink-0 whitespace-nowrap rounded-[10px] border border-danger-border bg-surface-card px-[18px] py-2.5 text-[13.5px] font-semibold text-danger-text transition-colors hover:bg-danger-wash"
          >
            Очистить статистику
          </button>
        </div>

        {/* Обнулённые видны и снаружи окна: иначе «почему у него три
            разговора, он же работает месяц» осталось бы без ответа */}
        {обнулённые.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-3.5">
            {обнулённые.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink-body">
                  {m.name} — статистика считается с {дата(m.statsResetAt!)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => обнулить(m.id, true)}
                  className="shrink-0 font-semibold text-brand-hover disabled:opacity-50"
                >
                  Вернуть
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10">
          <div className="flex max-h-full w-[520px] flex-col overflow-hidden rounded-[18px] bg-surface-card shadow-2xl">
            {!выбранный ? (
              <>
                <div className="shrink-0 px-[26px] pb-4 pt-6">
                  <div className="text-[18px] font-semibold text-ink">
                    Очистить статистику
                  </div>
                  <p className="mt-1 text-[13px] leading-normal text-ink-muted">
                    Выберите менеджера, которому хотите очистить статистику
                    разговоров
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-[26px] pb-2">
                  {managers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPicked(m.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-colors ${
                        m.statsResetAt
                          ? "border-line-soft opacity-60"
                          : "border-line-soft hover:border-line-accent"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
                        {initials(m.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">
                          {m.name}
                        </span>
                        <span className="block truncate text-[12.5px] text-ink-muted">
                          {m.statsResetAt
                            ? `Очищена ${дата(m.statsResetAt)}`
                            : `${m.jobTitle} · ${
                                m.avgScore === null ? "без оценок" : `${m.avgScore} / 10`
                              } · ${разговоров(m.total)}`}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex shrink-0 justify-end gap-2.5 border-t border-line-soft px-[26px] pb-5 pt-4">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[10px] border border-line-strong bg-surface-card px-5 py-2.5 text-[14px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
                  >
                    Закрыть
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="shrink-0 px-[26px] pb-4 pt-6">
                  <div className="text-[18px] font-semibold text-ink">
                    Очистить статистику {выбранный.name}?
                  </div>
                  <p className="mt-2 text-[13.5px] leading-normal text-ink-body">
                    Из статистики пропадёт {разговоров(выбранный.total)}. Сами
                    разговоры, расшифровки и разборы останутся на месте —
                    считаться будет только то, что после очистки.
                  </p>
                  <p className="mt-2 text-[13px] leading-normal text-ink-muted">
                    Передумаете — вернёте одним нажатием, ничего не потеряется.
                  </p>
                </div>
                <div className="flex shrink-0 justify-end gap-2.5 border-t border-line-soft px-[26px] pb-5 pt-4">
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="rounded-[10px] border border-line-strong bg-surface-card px-5 py-2.5 text-[14px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
                  >
                    Назад
                  </button>
                  <Button
                    type="button"
                    loading={busy}
                    onClick={() => обнулить(выбранный.id, false)}
                    className="px-5 py-2.5 text-[14px]"
                  >
                    Очистить
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
