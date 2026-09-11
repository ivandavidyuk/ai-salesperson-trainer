"use client";

// Раздел «Задания»: тренировки, назначенные руководителем.
// Каждое задание — готовая пара «тип + пациент» с комментарием и сроком;
// «Начать» открывает мастер настройки сразу на шаге «Обзор».

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/app/components/AppShell";
import DeleteAssignmentModal from "@/app/components/DeleteAssignmentModal";
import DoneAssignmentCard from "@/app/components/DoneAssignmentCard";
import EditAssignmentModal from "@/app/components/EditAssignmentModal";
import PatientInfoModal from "@/app/components/PatientInfoModal";
import Loader from "@/app/components/Loader";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import PatientAvatar from "@/app/components/PatientAvatar";
import { formatDueDate, initials, isOverdue, plural } from "@/lib/format";
import type { Assignment, DoneAssignment, WizardPatient } from "@/lib/training";

/** Сколько выполненных показываем сразу: «что закрыли на этой неделе» */
const ВЫПОЛНЕННЫХ_СРАЗУ = 3;

export default function TasksPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [done, setDone] = useState<DoneAssignment[]>([]);
  const [isHead, setIsHead] = useState(false);
  const [error, setError] = useState("");
  const [infoPatient, setInfoPatient] = useState<WizardPatient | null>(null);
  const [started, setStarted] = useState<Assignment | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);
  const [allDone, setAllDone] = useState(false);

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
      const payload = (await res.json()) as {
        active: Assignment[];
        done: DoneAssignment[];
      };
      setAssignments(payload.active);
      setDone(payload.done);
    } catch {
      setError("Не удалось загрузить задания");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const count = assignments?.length ?? 0;
  const видимыеВыполненные = allDone ? done : done.slice(0, ВЫПОЛНЕННЫХ_СРАЗУ);

  return (
    <AppShell title="Задания">
      <div className="mx-auto w-full max-w-[980px] px-10 pb-11 pt-[26px]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22.5px] font-semibold tracking-[-.01em] text-ink">
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
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand px-[22px] py-3 text-[16.5px] font-semibold text-white transition-colors hover:bg-brand-hover"
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
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}

        {error && (
          <p className="py-16 text-center text-sm text-danger-text">{error}</p>
        )}

        {assignments && count === 0 && done.length === 0 && (
          <div className="rounded-[14px] border border-line bg-surface-card px-6 py-14 text-center">
            <div className="text-[16.5px] font-semibold text-ink">
              Заданий пока нет
            </div>
            <p className="mx-auto mt-2 max-w-[420px] text-[15px] leading-normal text-ink-muted">
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
              onEdit={() => setEditing(item)}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </div>

        {/* Выполненных нет — раздела нет вовсе: заглушка на месте, где через
            неделю появится история, только занимает экран */}
        {done.length > 0 && (
          <div className="mt-8">
            <div className="mb-3.5 flex items-baseline gap-2.5">
              <div className="font-mono text-[12.5px] uppercase tracking-[.12em] text-brand-hover">
                Выполненные
              </div>
              <span className="rounded-full bg-surface-bubble px-2 py-0.5 text-[12px] font-semibold text-ink-subtle">
                {done.length}
              </span>
              <span className="text-xs text-ink-subtle">последние 30 дней</span>
              <div className="h-px flex-1 bg-line" />
            </div>

            <div className="flex flex-col gap-2.5">
              {видимыеВыполненные.map((item) => (
                <DoneAssignmentCard
                  key={item.id}
                  assignment={item}
                  isHead={isHead}
                />
              ))}
            </div>

            {!allDone && done.length > ВЫПОЛНЕННЫХ_СРАЗУ && (
              <button
                type="button"
                onClick={() => setAllDone(true)}
                className="mt-3 w-full rounded-[12px] border border-line bg-surface-card py-2.5 text-sm font-semibold text-brand-hover transition-colors hover:bg-surface-bubble"
              >
                Показать все {done.length}
              </button>
            )}
          </div>
        )}
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

      {editing && (
        <EditAssignmentModal
          assignment={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {deleting && (
        <DeleteAssignmentModal
          assignment={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}

interface AssignmentCardProps {
  assignment: Assignment;
  /** У руководителя вместо кнопки «Начать» — плашка «Кому» и меню «⋯» */
  isHead: boolean;
  onOpenPatient: () => void;
  onStart: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function AssignmentCard({
  assignment,
  isHead,
  onOpenPatient,
  onStart,
  onEdit,
  onDelete,
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
              <span className="rounded-full bg-danger-soft px-2.5 py-1 text-[12px] font-bold uppercase tracking-[.06em] text-danger-strong">
                Приоритет
              </span>
              {due && (
                <span className={`ml-auto whitespace-nowrap text-xs ${dueClass}`}>
                  {due}
                </span>
              )}
              {isHead && (
                <span className={due ? "" : "ml-auto"}>
                  <CardMenu onEdit={onEdit} onDelete={onDelete} />
                </span>
              )}
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[18px] font-semibold text-ink">
              {assignment.title}
            </div>
            {/* У приоритетного задания срок и меню стоят выше, в строке
                с плашкой, — иначе меню нарисовалось бы дважды */}
            {!assignment.isPriority && (
              <div className="flex shrink-0 items-baseline gap-2">
                {due && (
                  <span className={`whitespace-nowrap text-xs ${dueClass}`}>
                    {due}
                  </span>
                )}
                {isHead && <CardMenu onEdit={onEdit} onDelete={onDelete} />}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenPatient}
              title="О пациенте"
              className="-ml-1 inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm text-ink-body transition-colors hover:bg-surface-bubble"
            >
              <PatientAvatar
                name={assignment.patient.name}
                className="h-[34px] w-[34px] bg-brand-soft text-xs font-semibold text-brand"
                lazy
              />
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
            <span className="rounded-full bg-brand-soft px-[11px] py-1 text-[14.5px] font-semibold text-brand-hover">
              {assignment.trainingType.title}
            </span>

            {/* Кому назначено — только у руководителя, у менеджера это он сам */}
            {isHead && assignment.assignee && (
              <span className="ml-auto inline-flex items-center gap-2.5 rounded-full border border-line-accent bg-surface-accent py-[5px] pl-1.5 pr-3.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
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
                  <span className="font-mono text-[10px] uppercase tracking-[.12em] text-brand-score-label">
                    Кому
                  </span>
                  <span className="text-[15px] font-semibold text-brand-hover">
                    {assignment.assignee.name}
                  </span>
                </span>
              </span>
            )}
          </div>

          <div className="mt-3.5 rounded-[10px] bg-surface px-3.5 py-3">
            <div className="flex items-center gap-[7px] text-xs text-ink-subtle">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10.5px] font-semibold text-brand">
                {initials(assignment.author)}
              </span>
              {assignment.author} · Руководитель
            </div>
            <p className="mt-[7px] text-pretty text-[15px] leading-normal text-ink-body">
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

/**
 * Меню карточки: «⋯» в правом верхнем углу, видимое всегда.
 *
 * Не две кнопки: справа в карточке уже стоит плашка «Кому», и «Удалить»
 * рядом с ней читается как «удалить Алексея». И не действия при наведении:
 * то, что надо найти наведением, не находят — на этом уже обожглись
 * с переходом к расшифровке.
 */
function CardMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const закрыть = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const поEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", закрыть);
    document.addEventListener("keydown", поEscape);
    return () => {
      document.removeEventListener("mousedown", закрыть);
      document.removeEventListener("keydown", поEscape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((было) => !было)}
        title="Действия с заданием"
        aria-expanded={open}
        className="rounded-lg px-2 py-0.5 text-[19px] leading-none text-ink-icon transition-colors hover:bg-surface-bubble hover:text-ink-body"
      >
        ⋯
      </button>

      {open && (
        <div className="absolute right-0 top-[26px] z-20 w-[190px] overflow-hidden rounded-[12px] border border-line bg-surface-card py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full px-4 py-2.5 text-left text-[15px] text-ink transition-colors hover:bg-surface-bubble"
          >
            Редактировать
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-4 py-2.5 text-left text-[15px] text-danger-strong transition-colors hover:bg-danger-soft"
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}
