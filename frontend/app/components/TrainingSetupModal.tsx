"use client";

// Мастер настройки тренировки: Тип → Пациент → Обзор.
//
// Доступен пока только «Полный разговор» с Тамарой Михайловной: backend
// играет её роль захардкоженным промптом и про этапы не знает. Остальные
// варианты показаны заблокированными — видно, куда идём, но выбрать нельзя.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PatientInfoModal from "@/app/components/PatientInfoModal";
import Spinner from "@/app/components/Spinner";
import { initials } from "@/lib/format";
import {
  DIFFICULTY,
  GROUP_LABELS,
  GROUP_SHORT,
  type Assignment,
  type DifficultyKey,
  type TrainingGroup,
  type WizardPatient,
  type WizardTrainingType,
} from "@/lib/training";

interface TrainingSetupModalProps {
  onClose: () => void;
  /**
   * Задание от руководителя. Тип и пациент уже выбраны им, поэтому мастер
   * сжимается до одного шага «Обзор» — менеджеру остаётся прочитать
   * комментарий и начать.
   */
  assignment?: Assignment;
  /**
   * Пациент выбран заранее (запуск из раздела «Пациенты») — остаются
   * шаги «Тип» и «Обзор».
   */
  presetPatient?: WizardPatient;
}

type StepKey = "type" | "patient" | "review";

const STEP_META: Record<StepKey, { label: string; hint: string }> = {
  type: { label: "Тип", hint: "Выберите тип тренировки" },
  patient: { label: "Пациент", hint: "Выберите пациента" },
  review: { label: "Обзор", hint: "Проверьте параметры и начните" },
};

const FILTERS: { key: "all" | DifficultyKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "easy", label: "Лёгкий" },
  { key: "mid", label: "Средний" },
  { key: "hard", label: "Сложный" },
];

// Общая рамка карточки выбора: выбранная — тиловая, заблокированная — тусклая
function cardClasses(selected: boolean, disabled: boolean): string {
  const base =
    "flex w-full items-center gap-3 rounded-xl border-[length:1.5px] p-3.5 text-left transition-colors";
  if (disabled) {
    return `${base} cursor-not-allowed border-line bg-surface-bubble opacity-60`;
  }
  return selected
    ? `${base} border-brand bg-surface-accent`
    : `${base} border-line bg-surface-card hover:border-line-strong`;
}

function Radio({ selected, disabled }: { selected: boolean; disabled: boolean }) {
  return (
    <span
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
        selected ? "border-brand" : disabled ? "border-line-strong" : "border-[#C6D3D0]"
      }`}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-brand" />}
    </span>
  );
}

function SoonBadge() {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-ink-subtle">
      скоро
    </span>
  );
}

// Заголовок группы: подпись и линия до конца строки
function GroupTitle({ children, tone }: { children: string; tone?: "warn" }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <div
        className={`font-mono text-[11px] uppercase tracking-[.12em] ${
          tone === "warn" ? "text-warn" : "text-brand-hover"
        }`}
      >
        {children}
      </div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function DifficultyPill({ difficulty }: { difficulty: DifficultyKey }) {
  const tone = DIFFICULTY[difficulty];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold ${tone.pill}`}
    >
      <span className={`inline-block h-[5px] w-[5px] rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

export default function TrainingSetupModal({
  onClose,
  assignment,
  presetPatient,
}: TrainingSetupModalProps) {
  const router = useRouter();

  // Набор шагов зависит от того, что уже выбрано за менеджера
  const steps: StepKey[] = assignment
    ? ["review"]
    : presetPatient
      ? ["type", "review"]
      : ["type", "patient", "review"];

  const [step, setStep] = useState(0);
  const [typeId, setTypeId] = useState<string | null>(
    assignment?.trainingType.id ?? null
  );
  const [patientId, setPatientId] = useState<string | null>(
    assignment?.patient.id ?? presetPatient?.id ?? null
  );

  const currentStep = steps[step];
  const isLastStep = step === steps.length - 1;

  const [types, setTypes] = useState<WizardTrainingType[] | null>(null);
  const [patients, setPatients] = useState<WizardPatient[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | DifficultyKey>("all");

  const [infoPatient, setInfoPatient] = useState<WizardPatient | null>(null);
  const [starting, setStarting] = useState(false);

  // Типы и пациенты приходят из базы: там же лежат их промпты, которыми
  // backend собирает роль ИИ
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [typesRes, patientsRes] = await Promise.all([
          fetch("/api/training-types"),
          fetch("/api/patients"),
        ]);
        if (!typesRes.ok || !patientsRes.ok) throw new Error("request failed");
        const [typesData, patientsData] = await Promise.all([
          typesRes.json() as Promise<WizardTrainingType[]>,
          patientsRes.json() as Promise<WizardPatient[]>,
        ]);
        if (!cancelled) {
          setTypes(typesData);
          setPatients(patientsData);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Не удалось загрузить типы тренировки и пациентов");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape закрывает мастер, но не когда поверх открыта карточка пациента —
  // она гасит событие сама и закрывается первой
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Тип берём из справочника даже в режиме задания: в самом задании нет
  // описания и группы, а «Обзор» их показывает
  const selectedType = useMemo(
    () => types?.find((type) => type.id === typeId) ?? null,
    [types, typeId]
  );

  // Заранее выбранный пациент приходит целиком — справочника ждать не нужно
  const selectedPatient = useMemo(() => {
    if (assignment) return assignment.patient;
    if (presetPatient) return presetPatient;
    return patients?.find((patient) => patient.id === patientId) ?? null;
  }, [assignment, presetPatient, patients, patientId]);

  // Поиск идёт и по анамнезу: в макете так и задумано
  const visiblePatients = useMemo(() => {
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

  const canNext =
    currentStep === "type"
      ? selectedType !== null
      : currentStep === "patient"
        ? selectedPatient !== null
        : true;

  function handleStart() {
    if (!selectedType || !selectedPatient) return;
    setStarting(true);
    const params = new URLSearchParams({
      patient: selectedPatient.id,
      type: selectedType.id,
    });
    // По заданию разговор привязывается к нему — чтобы отметить выполненным
    if (assignment) params.set("assignment", assignment.id);
    router.push(`/session?${params.toString()}`);
  }

  // Ярлык «выбери за меня»: берёт только доступное и прыгает сразу на обзор.
  // Заранее выбранного пациента не трогает — его выбрали осознанно.
  function handleRandom() {
    const availableTypes = (types ?? []).filter((type) => type.isActive);
    if (availableTypes.length === 0) return;
    setTypeId(availableTypes[Math.floor(Math.random() * availableTypes.length)].id);

    if (!presetPatient) {
      const available = (patients ?? []).filter((patient) => patient.isActive);
      if (available.length === 0) return;
      setPatientId(available[Math.floor(Math.random() * available.length)].id);
    }
    setStep(steps.length - 1);
  }

  const typesByGroup = (group: TrainingGroup) =>
    (types ?? []).filter((type) => type.group === group);

  function renderTypeCard(type: WizardTrainingType) {
    const selected = typeId === type.id;
    const disabled = !type.isActive;
    return (
      <button
        key={type.id}
        type="button"
        disabled={disabled}
        onClick={() => setTypeId(type.id)}
        className={cardClasses(selected, disabled)}
      >
        <Radio selected={selected} disabled={disabled} />
        <span className="min-w-0">
          <span className="block text-[14.5px] font-semibold text-ink">
            {type.title}
          </span>
          <span className="mt-0.5 block text-pretty text-[12.5px] text-ink-muted">
            {type.description}
          </span>
        </span>
        {disabled && <SoonBadge />}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,26,24,.55)] p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Настройка тренировки"
    >
      <div
        className="relative flex max-h-full w-[660px] max-w-full flex-col overflow-hidden rounded-[18px] bg-surface shadow-[0_40px_100px_-30px_rgba(12,26,24,.75)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Шапка с шагами */}
        <div className="shrink-0 bg-surface-card px-6 pt-5">
          <div className="flex items-start gap-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[19px] font-semibold tracking-[-.01em] text-ink">
                Настройка тренировки
              </div>
              <div className="mt-[3px] text-pretty text-[13.5px] text-ink-muted">
                {assignment
                  ? `Задание: ${assignment.title}`
                  : `Шаг ${step + 1} из ${steps.length} · ${STEP_META[currentStep].hint}`}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Закрыть"
              aria-label="Закрыть"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-bubble text-lg leading-none text-ink-muted transition-colors hover:bg-line"
            >
              ×
            </button>
          </div>

          {/* Один шаг — показывать нечего (режим задания) */}
          {steps.length > 1 && (
          <div className="mt-[18px] flex items-center">
            {steps.map((key, index) => {
              const done = index < step;
              const active = index === step;
              const last = index === steps.length - 1;
              return (
                <div
                  key={key}
                  className={`flex items-center ${last ? "flex-none" : "min-w-0 flex-1"}`}
                >
                  <span
                    className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[12.5px] font-bold ${
                      done || active
                        ? "bg-brand text-white"
                        : "border-[length:1.5px] border-line-strong bg-surface-card text-ink-placeholder"
                    }`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span
                    className={`ml-2.5 whitespace-nowrap text-[13px] ${
                      active
                        ? "font-semibold text-ink"
                        : done
                          ? "font-medium text-brand-hover"
                          : "font-medium text-ink-placeholder"
                    }`}
                  >
                    {STEP_META[key].label}
                  </span>
                  {!last && (
                    <span
                      className={`mx-2.5 h-0.5 flex-1 rounded-full ${
                        done ? "bg-brand" : "bg-line"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          )}

          <div className="mt-[18px] h-px bg-line" />
        </div>

        {/* Тело шага */}
        <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-6 py-[22px]">
          {currentStep === "type" && !types && !loadError && (
            <div className="flex justify-center py-9 text-ink-muted">
              <Spinner />
            </div>
          )}

          {currentStep === "type" && loadError && (
            <p className="py-9 text-center text-sm text-danger-text">{loadError}</p>
          )}

          {currentStep === "type" && types && (
            <>
              <div>
                <GroupTitle>{GROUP_LABELS.full}</GroupTitle>
                {typesByGroup("full").map(renderTypeCard)}
              </div>
              <div>
                <GroupTitle>{GROUP_LABELS.stage}</GroupTitle>
                <div className="grid grid-cols-2 gap-2.5">
                  {typesByGroup("stage").map(renderTypeCard)}
                </div>
              </div>
              <div>
                <GroupTitle tone="warn">{GROUP_LABELS.special}</GroupTitle>
                {typesByGroup("special").map(renderTypeCard)}
              </div>
            </>
          )}

          {currentStep === "patient" && (
            <div>
              <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface-card px-3.5 py-2.5">
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
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
                />
              </div>

              <div className="mb-3.5 flex flex-wrap gap-[7px]">
                {FILTERS.map((item) => {
                  const active = filter === item.key;
                  const dot = item.key !== "all" ? DIFFICULTY[item.key].dot : null;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setFilter(item.key)}
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-line-strong bg-surface-card text-ink-muted hover:border-brand-soft"
                      }`}
                    >
                      {dot && (
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            active ? "bg-white" : dot
                          }`}
                        />
                      )}
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {!patients && !loadError && (
                <div className="flex justify-center py-9 text-ink-muted">
                  <Spinner />
                </div>
              )}

              {loadError && (
                <p className="py-9 text-center text-sm text-danger-text">{loadError}</p>
              )}

              <div className="flex flex-col gap-2">
                {visiblePatients.map((patient) => {
                  const selected = patientId === patient.id;
                  const disabled = !patient.isActive;
                  return (
                    <div
                      key={patient.id}
                      className={cardClasses(selected, disabled)}
                      onClick={() => {
                        if (!disabled) setPatientId(patient.id);
                      }}
                    >
                      <Radio selected={selected} disabled={disabled} />

                      {/* Имя — кнопка: открывает карточку, не выбирая пациента */}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setInfoPatient(patient);
                        }}
                        title="О пациенте"
                        className="-ml-1 inline-flex min-w-0 items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-bubble"
                      >
                        <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                          {initials(patient.name)}
                        </span>
                        <span className="min-w-0 text-left">
                          <span className="block whitespace-nowrap text-[14.5px] font-semibold text-ink">
                            {patient.name}
                          </span>
                          {patient.description && (
                            <span className="block truncate text-[12px] text-ink-subtle">
                              {patient.description}
                            </span>
                          )}
                        </span>
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

                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {disabled && <SoonBadge />}
                        <DifficultyPill difficulty={patient.difficulty} />
                      </span>
                    </div>
                  );
                })}
              </div>

              {patients && visiblePatients.length === 0 && (
                <div className="px-5 py-9 text-center">
                  <div className="text-[15px] font-semibold text-ink-muted">
                    Ничего не найдено
                  </div>
                  <div className="mt-1.5 text-[13px] text-ink-subtle">
                    Измените запрос или сбросьте фильтр.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* В режиме задания «Обзор» — первый экран, справочник типов
              ещё может грузиться */}
          {currentStep === "review" && !selectedType && !loadError && (
            <div className="flex justify-center py-9 text-ink-muted">
              <Spinner />
            </div>
          )}

          {currentStep === "review" && loadError && (
            <p className="py-9 text-center text-sm text-danger-text">{loadError}</p>
          )}

          {currentStep === "review" && selectedType && selectedPatient && (
            <>
              <div>
                <div className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                  Тип тренировки
                </div>
                <div className="flex items-center gap-3 rounded-xl border-[length:1.5px] border-line-accent bg-surface-accent px-4 py-[15px]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M8 5.5l11 6.5-11 6.5z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink">
                      {selectedType.title}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-ink-muted">
                      {selectedType.description}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap rounded-full border border-line-accent bg-surface-card px-2.5 py-1 text-[10.5px] font-semibold text-brand-hover">
                    {GROUP_SHORT[selectedType.group]}
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                  Пациент
                </div>
                <div className="rounded-xl border-[length:1.5px] border-line-accent bg-surface-accent px-4 py-[15px]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInfoPatient(selectedPatient)}
                      title="О пациенте"
                      className="-ml-1 inline-flex min-w-0 items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-3 transition-colors hover:bg-[#DCEDE9]"
                    >
                      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[17px] font-semibold text-brand">
                        {initials(selectedPatient.name)}
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block whitespace-nowrap text-base font-semibold text-ink">
                          {selectedPatient.name}
                        </span>
                        {selectedPatient.description && (
                          <span className="block text-[12.5px] text-ink-subtle">
                            {selectedPatient.description}
                          </span>
                        )}
                      </span>
                      <svg
                        width="14"
                        height="14"
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
                    <span className="ml-auto">
                      <DifficultyPill difficulty={selectedPatient.difficulty} />
                    </span>
                  </div>
                  {selectedPatient.anamnesis && (
                    <p className="mt-3 text-pretty text-[13px] leading-normal text-ink-body">
                      {selectedPatient.anamnesis}
                    </p>
                  )}
                </div>
              </div>

              {assignment && (
                <div>
                  <div className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                    Комментарий руководителя
                  </div>
                  <div className="rounded-xl border border-line bg-surface-card px-4 py-3.5">
                    <div className="flex items-center gap-[7px] text-xs text-ink-subtle">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[9px] font-semibold text-brand">
                        {initials(assignment.author)}
                      </span>
                      {assignment.author} · Руководитель
                    </div>
                    <p className="mt-[7px] text-pretty text-[13.5px] leading-normal text-ink-body">
                      {assignment.comment}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Футер */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-card px-6 py-[15px]">
          {/* На первом шаге возвращаться некуда — только отмена */}
          {step === 0 ? (
            <button
              type="button"
              onClick={onClose}
              className="px-1 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink-body"
            >
              Отмена
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="inline-flex items-center gap-1.5 px-1 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink-body"
            >
              ‹ Назад
            </button>
          )}

          <div className="flex items-center gap-2.5">
            {!isLastStep && (
              <button
                type="button"
                onClick={handleRandom}
                title="Выбрать случайно и перейти к обзору"
                className="inline-flex items-center gap-2 rounded-input border border-line-accent bg-surface-card px-[18px] py-3 text-[14.5px] font-semibold text-brand-hover transition-colors hover:bg-surface-accent"
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
                  <path d="M16 3h5v5" />
                  <path d="M4 20L21 3" />
                  <path d="M21 16v5h-5" />
                  <path d="M15 15l6 6" />
                  <path d="M4 4l5 5" />
                </svg>
                Случайный
              </button>
            )}

            {!isLastStep ? (
              <button
                type="button"
                disabled={!canNext}
                onClick={() => setStep(step + 1)}
                className={`rounded-input px-[26px] py-3 text-[15px] font-semibold text-white transition-colors ${
                  canNext
                    ? "bg-brand hover:bg-brand-hover"
                    : "cursor-not-allowed bg-disabled"
                }`}
              >
                Далее ›
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={starting}
                className="inline-flex items-center gap-2.5 rounded-input bg-brand px-[26px] py-[13px] text-[15px] font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand-muted"
              >
                {starting ? (
                  <Spinner />
                ) : (
                  <span className="inline-block h-2 w-2 rounded-full bg-white" />
                )}
                Начать тренировку
              </button>
            )}
          </div>
        </div>

        {infoPatient && (
          <PatientInfoModal
            patient={infoPatient}
            onClose={() => setInfoPatient(null)}
          />
        )}
      </div>
    </div>
  );
}
