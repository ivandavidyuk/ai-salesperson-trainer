"use client";

// Правка задания — один экран, а не мастер.
//
// Мастер ведёт того, кто не знает, что выбирать. При правке человек знает:
// он пришёл поменять одну вещь — срок или комментарий. Гонять его через
// четыре шага ради даты значит издеваться. Поэтому текстовые поля правятся
// на месте, а тип, пациент и адресат стоят карточками с кнопкой «Изменить»:
// она открывает тот же шаг того же мастера, в режиме выбора.

import { useState } from "react";
import Field from "@/app/components/Field";
import PatientAvatar from "@/app/components/PatientAvatar";
import Spinner from "@/app/components/Spinner";
import TrainingSetupModal from "@/app/components/TrainingSetupModal";
import { initials } from "@/lib/format";
import { splitPatientSubtitle } from "@/lib/training";
import type {
  Assignment,
  ManagerOption,
  WizardPatient,
  WizardTrainingType,
} from "@/lib/training";

interface EditAssignmentModalProps {
  assignment: Assignment;
  onClose: () => void;
  /** Задание сохранено — списку пора обновиться */
  onSaved: () => void;
}

/** Что правим. Значения отделены от задания: отмена не должна ничего менять */
interface Черновик {
  title: string;
  comment: string;
  dueAt: string;
  isPriority: boolean;
  typeId: string;
  typeTitle: string;
  patientId: string;
  patientName: string;
  patientSubtitle: string | null;
  managerId: string | null;
  managerName: string | null;
  managerAvatar: string | null;
}

/** ISO из базы → значение для <input type="date"> */
const кДате = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export default function EditAssignmentModal({
  assignment,
  onClose,
  onSaved,
}: EditAssignmentModalProps) {
  const [черновик, setЧерновик] = useState<Черновик>({
    title: assignment.title,
    comment: assignment.comment,
    dueAt: кДате(assignment.dueAt),
    isPriority: assignment.isPriority,
    typeId: assignment.trainingType.id,
    typeTitle: assignment.trainingType.title,
    patientId: assignment.patient.id,
    patientName: assignment.patient.name,
    patientSubtitle: assignment.patient.description,
    managerId: assignment.assignee?.id ?? null,
    managerName: assignment.assignee?.name ?? null,
    managerAvatar: assignment.assignee?.avatarUpdatedAt ?? null,
  });
  const [выбираем, setВыбираем] = useState<"type" | "patient" | "assign" | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function принятьВыбор(выбор: {
    type: WizardTrainingType | null;
    patient: WizardPatient | null;
    manager: ManagerOption | null;
  }) {
    setЧерновик((прежний) => ({
      ...прежний,
      ...(выбор.type
        ? { typeId: выбор.type.id, typeTitle: выбор.type.title }
        : {}),
      ...(выбор.patient
        ? {
            patientId: выбор.patient.id,
            patientName: выбор.patient.name,
            patientSubtitle: выбор.patient.description,
          }
        : {}),
      ...(выбор.manager
        ? {
            managerId: выбор.manager.id,
            managerName: выбор.manager.name,
            managerAvatar: выбор.manager.avatarUpdatedAt,
          }
        : {}),
    }));
    setВыбираем(null);
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: черновик.title,
          comment: черновик.comment,
          dueAt: черновик.dueAt || null,
          isPriority: черновик.isPriority,
          trainingTypeId: черновик.typeId,
          patientId: черновик.patientId,
          userId: черновик.managerId ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "request failed");
      }
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error && e.message !== "request failed"
          ? e.message
          : "Не удалось сохранить задание"
      );
      setSaving(false);
    }
  }

  const { age } = splitPatientSubtitle(черновик.patientSubtitle);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10">
        <div className="flex max-h-full w-[620px] flex-col overflow-hidden rounded-[18px] bg-surface-card shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-[18px]">
            <div>
              <div className="text-[19px] font-semibold text-ink">
                Правка задания
              </div>
              {черновик.managerName && (
                // Имя в именительном падеже: склонять его в коде значит
                // однажды выдать «у Ван Хао» вместо «у Вана Хао» — или
                // наоборот. Фраза построена так, чтобы падеж не понадобился
                <div className="mt-0.5 text-[13.5px] text-ink-muted">
                  Задание уже назначено: {черновик.managerName} увидит правки
                  сразу
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Закрыть"
              className="-mr-1 shrink-0 rounded-lg px-2 py-1 text-[22px] leading-none text-ink-icon transition-colors hover:bg-surface-bubble hover:text-ink-body"
            >
              ×
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-[22px]">
            <Field
              label="Заголовок"
              value={черновик.title}
              onChange={(event) =>
                setЧерновик({ ...черновик, title: event.target.value })
              }
              placeholder="Возражение по цене операции"
            />

            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Срок"
                type="date"
                value={черновик.dueAt}
                onChange={(event) =>
                  setЧерновик({ ...черновик, dueAt: event.target.value })
                }
              />
              <label className="flex cursor-pointer items-end gap-2.5 pb-3">
                <input
                  type="checkbox"
                  checked={черновик.isPriority}
                  onChange={(event) =>
                    setЧерновик({
                      ...черновик,
                      isPriority: event.target.checked,
                    })
                  }
                  className="h-[18px] w-[18px] accent-brand"
                />
                <span className="text-sm text-ink-body">
                  Приоритетное задание
                </span>
              </label>
            </div>

            <ВыборСтрокой
              метка="Тип тренировки"
              заголовок={черновик.typeTitle}
              onChange={() => setВыбираем("type")}
            />

            <ВыборСтрокой
              метка="Пациент"
              заголовок={черновик.patientName}
              подпись={age}
              слева={
                <PatientAvatar
                  name={черновик.patientName}
                  className="h-[34px] w-[34px] bg-brand-soft text-xs font-semibold text-brand"
                  lazy
                />
              }
              onChange={() => setВыбираем("patient")}
            />

            <ВыборСтрокой
              метка="Кому назначено"
              заголовок={черновик.managerName ?? "Не выбран"}
              слева={
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-xs font-semibold text-brand">
                  {черновик.managerAvatar && черновик.managerId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/users/${черновик.managerId}/avatar?v=${encodeURIComponent(черновик.managerAvatar)}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials(черновик.managerName)
                  )}
                </span>
              }
              onChange={() => setВыбираем("assign")}
            />

            <div>
              <div className="mb-1.5 font-mono text-[12.5px] uppercase tracking-[.12em] text-brand-hover">
                Комментарий
              </div>
              <textarea
                value={черновик.comment}
                onChange={(event) =>
                  setЧерновик({ ...черновик, comment: event.target.value })
                }
                placeholder="Например: отвечай выгодой клиента, а не оправданием цены"
                className="min-h-[96px] w-full resize-y rounded-xl border-[length:1.5px] border-line bg-surface-card px-3.5 py-3 text-sm leading-normal text-ink outline-none transition-colors placeholder:text-ink-placeholder focus:border-brand"
              />
            </div>

            {error && <p className="text-sm text-danger-text">{error}</p>}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-line bg-surface-card px-6 py-[15px]">
            <button
              type="button"
              onClick={onClose}
              className="px-1 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink-body"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || черновик.title.trim() === ""}
              className="inline-flex items-center gap-2 rounded-input bg-brand px-[26px] py-[13px] text-[16.5px] font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand-muted"
            >
              {saving && <Spinner />}
              Сохранить
            </button>
          </div>
        </div>
      </div>

      {/* Тот же мастер, что и при создании: список карточек, «Готово»
          возвращает выбор сюда */}
      {выбираем && (
        <TrainingSetupModal
          pickOnly={выбираем}
          pickInitial={{
            typeId: черновик.typeId,
            patientId: черновик.patientId,
            managerId: черновик.managerId ?? undefined,
          }}
          onPick={принятьВыбор}
          onClose={() => setВыбираем(null)}
        />
      )}
    </>
  );
}

function ВыборСтрокой({
  метка,
  заголовок,
  подпись,
  слева,
  onChange,
}: {
  метка: string;
  заголовок: string;
  подпись?: string | null;
  слева?: React.ReactNode;
  onChange: () => void;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[12.5px] uppercase tracking-[.12em] text-brand-hover">
        {метка}
      </div>
      <div className="flex items-center gap-3 rounded-xl border-[length:1.5px] border-line bg-surface-card p-3">
        {слева}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15.5px] font-semibold text-ink">
            {заголовок}
          </div>
          {подпись && (
            <div className="mt-0.5 text-[13px] text-ink-subtle">{подпись}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-[10px] border border-line-strong bg-surface-card px-[15px] py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-bubble"
        >
          Изменить
        </button>
      </div>
    </div>
  );
}
