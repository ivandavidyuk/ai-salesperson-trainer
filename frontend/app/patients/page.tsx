"use client";

// Раздел «Пациенты»: библиотека ИИ-клиентов для тренировок.
// Поиск по имени и анамнезу, фильтр по сложности, запуск тренировки
// с выбранным пациентом.

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/app/components/AppShell";
import PatientInfoModal from "@/app/components/PatientInfoModal";
import Spinner from "@/app/components/Spinner";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import { initials, plural } from "@/lib/format";
import { DIFFICULTY, type DifficultyKey, type WizardPatient } from "@/lib/training";

const FILTERS: { key: "all" | DifficultyKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "easy", label: "Лёгкий" },
  { key: "mid", label: "Средний" },
  { key: "hard", label: "Сложный" },
];

export default function PatientsPage() {
  const [patients, setPatients] = useState<WizardPatient[] | null>(null);
  const [isHead, setIsHead] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | DifficultyKey>("all");

  const [infoPatient, setInfoPatient] = useState<WizardPatient | null>(null);
  const [started, setStarted] = useState<WizardPatient | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Роль решает, показывать ли кнопку «Подробнее»: разбор пациента
        // API отдаёт только руководителю
        const [meRes, res] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/patients"),
        ]);
        if (meRes.ok && !cancelled) {
          const me = (await meRes.json()) as { role?: string };
          setIsHead(me.role === "head");
        }
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as WizardPatient[];
        if (!cancelled) setPatients(data);
      } catch {
        if (!cancelled) setError("Не удалось загрузить пациентов");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Поиск идёт и по анамнезу: искать «катаракту», а не только имя
  const visible = useMemo(() => {
    if (!patients) return [];
    const needle = query.trim().toLowerCase();
    return patients.filter((patient) => {
      if (filter !== "all" && patient.difficulty !== filter) return false;
      if (!needle) return true;
      return (
        patient.name.toLowerCase().includes(needle) ||
        (patient.anamnesis ?? "").toLowerCase().includes(needle)
      );
    });
  }, [patients, query, filter]);

  return (
    <AppShell title="Пациенты">
      <div className="mx-auto w-full max-w-[1440px] px-10 pb-11 pt-[26px]">
        <div className="mb-1.5 flex items-baseline justify-between gap-4">
          <h1 className="text-[21px] font-semibold tracking-[-.01em] text-ink">
            Библиотека пациентов
          </h1>
          {patients && (
            <div className="shrink-0 text-[13px] text-ink-subtle">
              {visible.length}{" "}
              {plural(visible.length, "пациент", "пациента", "пациентов")}
            </div>
          )}
        </div>
        <p className="mb-5 text-sm text-ink-muted">
          Выберите, с кем провести тренировку — у каждого свой характер и повод
          для визита
        </p>

        {/* Поиск и фильтр по сложности */}
        <div className="mb-[22px] flex flex-wrap items-center gap-3.5">
          <div className="flex min-w-[260px] flex-1 items-center gap-2.5 rounded-xl border border-line-strong bg-surface-card px-3.5 py-2.5">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-ink-icon"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по имени или анамнезу"
              aria-label="Поиск пациента"
              className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-placeholder"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => {
              const active = filter === item.key;
              const dot = item.key !== "all" ? DIFFICULTY[item.key].dot : null;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={`inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border px-[15px] py-2 text-[13px] font-semibold transition-colors ${
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-line-strong bg-surface-card text-ink-muted hover:border-brand-soft"
                  }`}
                >
                  {dot && (
                    <span
                      className={`inline-block h-[7px] w-[7px] rounded-full ${
                        active ? "bg-white" : dot
                      }`}
                    />
                  )}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {!patients && !error && (
          <div className="flex justify-center py-16 text-ink-muted">
            <Spinner />
          </div>
        )}

        {error && (
          <p className="py-16 text-center text-sm text-danger-text">{error}</p>
        )}

        <div className="flex flex-wrap gap-4">
          {visible.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              isHead={isHead}
              onOpenInfo={() => setInfoPatient(patient)}
              onStart={() => setStarted(patient)}
            />
          ))}

          {patients && visible.length === 0 && (
            <div className="w-full px-5 py-14 text-center">
              <div className="text-base font-semibold text-ink-muted">
                Ничего не найдено
              </div>
              <div className="mt-1.5 text-sm text-ink-subtle">
                Измените запрос или сбросьте фильтр сложности.
              </div>
            </div>
          )}
        </div>
      </div>

      {infoPatient && (
        <PatientInfoModal
          patient={infoPatient}
          onClose={() => setInfoPatient(null)}
        />
      )}

      {started && (
        <TrainingSetupModal
          presetPatient={started}
          onClose={() => setStarted(null)}
        />
      )}
    </AppShell>
  );
}

interface PatientCardProps {
  patient: WizardPatient;
  /** У руководителя рядом с «Начать» появляется «Подробнее» */
  isHead: boolean;
  onOpenInfo: () => void;
  onStart: () => void;
}

function PatientCard({
  patient,
  isHead,
  onOpenInfo,
  onStart,
}: PatientCardProps) {
  const difficulty = DIFFICULTY[patient.difficulty];
  // Промпта ещё нет — тренировку не начать, backend всё равно откажет
  const blocked = !patient.isActive;

  return (
    // Три колонки при gap-4: (100% − 2 × 16px) / 3
    <div className="flex w-[calc((100%-32px)/3)] flex-col rounded-[14px] border border-line bg-surface-card p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[17px] font-semibold text-brand">
          {initials(patient.name)}
        </span>
        <div className="min-w-0 flex-1">
          {/* Имя — кнопка: открывает карточку с полным анамнезом */}
          <button
            type="button"
            onClick={onOpenInfo}
            title="О пациенте"
            className="inline-flex max-w-full items-center gap-1.5 text-left text-base font-semibold text-ink transition-colors hover:text-brand-hover"
          >
            <span className="truncate">{patient.name}</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              className="shrink-0 text-ink-icon"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {patient.description && (
            <div className="mt-px truncate text-[13px] text-ink-subtle">
              {patient.description}
            </div>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${difficulty.pill}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${difficulty.dot}`} />
          {difficulty.label}
        </span>
      </div>

      {/* flex-1 выравнивает кнопки по низу, даже если анамнезы разной длины */}
      <div className="mt-4 flex-1">
        <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
          Анамнез
        </div>
        <p className="mt-1.5 line-clamp-4 text-pretty text-[13.5px] leading-normal text-ink-body">
          {patient.anamnesis || "Анамнез пока не заполнен."}
        </p>
      </div>

      <div className="mt-[18px] flex gap-2">
        {/* Досье с разбором — только у руководителя */}
        {isHead && (
          <button
            type="button"
            onClick={onOpenInfo}
            title="Подробнее о пациенте"
            className="flex flex-1 items-center justify-center gap-[7px] rounded-input border-[length:1.5px] border-brand bg-surface-accent px-2 py-3 text-sm font-semibold text-brand-hover transition-colors hover:bg-[#DCEDE9]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2h-2" />
              <rect x="9" y="2" width="6" height="4" rx="1" />
              <path d="M8.5 11.5h7" />
              <path d="M8.5 15.5h4" />
            </svg>
            Подробнее
          </button>
        )}

        <button
          type="button"
          onClick={onStart}
          disabled={blocked}
          title={blocked ? "Для этого пациента ещё не готов промпт" : undefined}
          className={`flex flex-1 items-center justify-center gap-2 rounded-input px-2 py-3 text-[15px] font-semibold text-white transition-colors ${
            blocked
              ? "cursor-not-allowed bg-disabled"
              : "bg-brand hover:bg-brand-hover"
          }`}
        >
          {blocked ? (
            "Скоро"
          ) : (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-white" />
              Начать
            </>
          )}
        </button>
      </div>
    </div>
  );
}
