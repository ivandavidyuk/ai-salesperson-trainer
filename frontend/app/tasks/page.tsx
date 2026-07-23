"use client";

// Раздел «Задания»: тренировки, назначенные руководителем.
// Каждое задание — готовая пара «тип + пациент» с комментарием и сроком;
// «Начать» открывает мастер настройки сразу на шаге «Обзор».

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/app/components/AppShell";
import PatientInfoModal from "@/app/components/PatientInfoModal";
import Spinner from "@/app/components/Spinner";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import { formatDueDate, initials, isOverdue, plural } from "@/lib/format";
import type { Assignment, WizardPatient } from "@/lib/training";

export default function TasksPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [isHead, setIsHead] = useState(false);
  const [error, setError] = useState("");
  const [infoPatient, setInfoPatient] = useState<WizardPatient | null>(null);
  const [started, setStarted] = useState<Assignment | null>(null);
  const [creating, setCreating] = useState(false);

  // Роль решает, что показывать: руководитель задания выставляет,
  // менеджер — получает
  const load = useCallback(async () => {
    try {
      const [meRes, res] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/assignments"),
      ]);
      if (meRes.ok) {
        const me = (await meRes.json()) as { role?: string };
        setIsHead(me.role === "head");
      }
      if (!res.ok) throw new Error("request failed");
      setAssignments((await res.json()) as Assignment[]);
    } catch {
      setError("Не удалось загрузить задания");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const count = assignments?.length ?? 0;

  return (
    <AppShell title="Задания">
      <div className="mx-auto w-full max-w-[1080px] px-10 pb-11 pt-[26px]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[21px] font-semibold tracking-[-.01em] text-ink">
              {isHead ? "Выставленные задания" : "От вашего руководителя"}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {isHead
                ? "Тренировки, которые вы назначили менеджерам"
                : "Руководитель назначил тренировки на основе ваших разговоров"}
              {assignments && count > 0 && (
                <>
                  {" · "}
                  {count}{" "}
                  {plural(count, "активное", "активных", "активных")}
                </>
              )}
            </p>
          </div>

          {isHead && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand px-[22px] py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              Создать
            </button>
          )}
        </div>

        {!assignments && !error && (
          <div className="flex justify-center py-16 text-ink-muted">
            <Spinner />
          </div>
        )}

        {error && (
          <p className="py-16 text-center text-sm text-danger-text">{error}</p>
        )}

        {assignments && count === 0 && (
          <div className="rounded-[14px] border border-line bg-surface-card px-6 py-14 text-center">
            <div className="text-[15px] font-semibold text-ink">
              Заданий пока нет
            </div>
            <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-normal text-ink-muted">
              {isHead
                ? "Нажмите «Создать», чтобы назначить менеджеру тренировку."
                : "Когда руководитель назначит тренировку, она появится здесь. А пока можно начать разговор самостоятельно с главной."}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3.5">
          {assignments?.map((item) => (
            <AssignmentCard
              key={item.id}
              assignment={item}
              isHead={isHead}
              onOpenPatient={() => setInfoPatient(item.patient)}
              onStart={() => setStarted(item)}
            />
          ))}
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
          assignment={started}
          onClose={() => setStarted(null)}
        />
      )}

      {creating && (
        <TrainingSetupModal
          createMode
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </AppShell>
  );
}

interface AssignmentCardProps {
  assignment: Assignment;
  /** У руководителя вместо кнопки «Начать» — плашка «Кому» */
  isHead: boolean;
  onOpenPatient: () => void;
  onStart: () => void;
}

function AssignmentCard({
  assignment,
  isHead,
  onOpenPatient,
  onStart,
}: AssignmentCardProps) {
  const overdue = isOverdue(assignment.dueAt);
  const due = formatDueDate(assignment.dueAt);
  // Пациента или тип могли отключить после выдачи задания — запускать
  // такую тренировку нельзя, backend всё равно откажет
  const blocked =
    !assignment.patient.isActive || !assignment.trainingType.isActive;

  const dueClass = overdue
    ? "font-semibold text-danger-strong"
    : "text-ink-subtle";

  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-line bg-surface-card ${
        assignment.isPriority ? "border-l-[3px] border-l-danger-strong" : ""
      }`}
    >
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 px-[22px] py-5">
          {/* У приоритетного задания срок уезжает в строку с плашкой,
              у обычного — встаёт рядом с заголовком (как в макете) */}
          {assignment.isPriority && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <span className="rounded-full bg-danger-soft px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[.06em] text-danger-strong">
                Приоритет
              </span>
              {due && (
                <span className={`ml-auto whitespace-nowrap text-xs ${dueClass}`}>
                  {due}
                </span>
              )}
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[16.5px] font-semibold text-ink">
              {assignment.title}
            </div>
            {!assignment.isPriority && due && (
              <span
                className={`shrink-0 whitespace-nowrap text-xs ${dueClass}`}
              >
                {due}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenPatient}
              title="О пациенте"
              className="-ml-1 inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm text-ink-body transition-colors hover:bg-surface-bubble"
            >
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {initials(assignment.patient.name)}
              </span>
              {assignment.patient.name}
              <svg
                width="12"
                height="12"
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
            <span className="rounded-full bg-brand-soft px-[11px] py-1 text-[13px] font-semibold text-brand-hover">
              {assignment.trainingType.title}
            </span>

            {/* Кому назначено — только у руководителя, у менеджера это он сам */}
            {isHead && assignment.assignee && (
              <span className="ml-auto inline-flex items-center gap-2.5 rounded-full border border-line-accent bg-surface-accent py-[5px] pl-1.5 pr-3.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-[11.5px] font-semibold text-brand">
                  {assignment.assignee.avatarUpdatedAt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/users/${assignment.assignee.id}/avatar?v=${encodeURIComponent(assignment.assignee.avatarUpdatedAt)}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials(assignment.assignee.name)
                  )}
                </span>
                <span className="flex flex-col leading-[1.15]">
                  <span className="font-mono text-[8.5px] uppercase tracking-[.12em] text-brand-score-label">
                    Кому
                  </span>
                  <span className="text-[13.5px] font-semibold text-brand-hover">
                    {assignment.assignee.name}
                  </span>
                </span>
              </span>
            )}
          </div>

          <div className="mt-3.5 rounded-[10px] bg-surface px-3.5 py-3">
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

        {/* Руководитель задания не проходит — кнопки у него нет */}
        {!isHead && (
          <button
            type="button"
            onClick={onStart}
            disabled={blocked}
            title={
              blocked
                ? "Пациент или тип тренировки пока недоступен"
                : "Начать тренировку"
            }
            className={`shrink-0 self-stretch px-[34px] text-base font-semibold text-white transition-colors ${
              blocked
                ? "cursor-not-allowed bg-disabled"
                : "bg-brand hover:bg-brand-hover"
            }`}
          >
            Начать
          </button>
        )}
      </div>
    </div>
  );
}
