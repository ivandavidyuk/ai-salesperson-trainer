"use client";

// Выбор пациента, тумблер модели голоса и «Начать»: дальше обычный разговор
// на /session с параметром tts, по которому backend открывает сокет нужной
// модели.

import { useRouter } from "next/navigation";
import { useState } from "react";
import AppShell from "@/app/components/AppShell";
import Button from "@/app/components/Button";

type Модель = "flash" | "v4";

const МОДЕЛИ: { key: Модель; label: string }[] = [
  { key: "flash", label: "Старая модель (Flash)" },
  { key: "v4", label: "Новая модель (v4 Turbo)" },
];

interface Пациент {
  id: string;
  name: string;
}

// Кнопка выбора: тот же вид, что у переключателя периода в статистике
function выбор(активна: boolean): string {
  return `rounded-[8px] px-3 py-2 text-[14px] font-semibold transition-colors max-md:min-h-11 max-md:text-[15px] ${
    активна ? "bg-brand text-white" : "text-ink-muted hover:bg-surface-bubble"
  }`;
}

export default function StandForm({ patients }: { patients: Пациент[] }) {
  const router = useRouter();
  const [пациент, setПациент] = useState(patients[0].id);
  const [модель, setМодель] = useState<Модель>("flash");

  function начать() {
    const params = new URLSearchParams({
      patient: пациент,
      type: "full",
      tts: модель,
    });
    router.push(`/session?${params.toString()}`);
  }

  return (
    <AppShell title="Стенд голоса">
      <div className="mx-auto w-full max-w-[1760px] px-10 pb-11 pt-[26px] max-md:px-4 max-md:pb-6 max-md:pt-4">
        <div className="max-w-[720px] rounded-xl border border-line bg-surface-card p-6 shadow-card max-md:p-5">
          <p className="text-[15px] leading-snug text-ink-muted">
            Полный разговор, как в обычной тренировке. Отличается только
            модель, которой звучит пациент.
          </p>

          <h2 className="mt-5 text-[15px] font-semibold text-ink">Пациент</h2>
          <div
            className="mt-2 grid grid-cols-3 gap-1 rounded-[11px] border border-line bg-surface-card p-1 max-md:grid-cols-2"
            role="group"
            aria-label="Пациент"
          >
            {patients.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setПациент(item.id)}
                aria-pressed={item.id === пациент}
                className={выбор(item.id === пациент)}
              >
                {item.name}
              </button>
            ))}
          </div>

          <h2 className="mt-5 text-[15px] font-semibold text-ink">Модель голоса</h2>
          <div
            className="mt-2 grid grid-cols-2 gap-1 rounded-[11px] border border-line bg-surface-card p-1"
            role="group"
            aria-label="Модель голоса"
          >
            {МОДЕЛИ.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setМодель(item.key)}
                aria-pressed={item.key === модель}
                className={выбор(item.key === модель)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <Button className="mt-5 w-full" onClick={начать}>
            Начать
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
