"use client";

// «Удалить задание?» — спрашиваем всегда.
//
// Отменить удаление нельзя, а задание могло быть уже начато. Руководитель
// удаляет из меню, а не из карточки, поэтому название повторяем дословно:
// он должен видеть, что именно уходит. Окно одно на оба случая, начатое
// от неначатого отличает одна фраза.

import { useState } from "react";
import Spinner from "@/app/components/Spinner";
import { formatDueDate } from "@/lib/format";
import type { Assignment } from "@/lib/training";

interface DeleteAssignmentModalProps {
  assignment: Assignment;
  onClose: () => void;
  /** Задание удалено — списку пора обновиться */
  onDeleted: () => void;
}

export default function DeleteAssignmentModal({
  assignment,
  onClose,
  onDeleted,
}: DeleteAssignmentModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const кому = assignment.assignee?.name ?? "Менеджер";
  const срок = formatDueDate(assignment.dueAt);

  async function handleDelete() {
    setError("");
    setDeleting(true);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("request failed");
      onDeleted();
    } catch {
      setError("Не удалось удалить задание");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10">
      <div className="w-[520px] rounded-[18px] bg-surface-card px-8 pb-[26px] pt-[30px] shadow-2xl">
        <div className="text-[20.5px] font-semibold text-ink">
          Удалить задание?
        </div>

        <div className="mt-4 rounded-[11px] border border-line-soft bg-surface px-[15px] py-3">
          <div className="text-[15.5px] font-semibold text-ink">
            {assignment.title}
          </div>
          <div className="mt-1 text-[13.5px] text-ink-subtle">
            {кому}
            {срок && ` · ${срок}`}
          </div>
        </div>

        <p
          className={`mt-[18px] rounded-[11px] px-[15px] py-3 text-[14.5px] leading-normal ${
            assignment.started
              ? "bg-warn-surface text-warn"
              : "bg-surface text-ink-muted"
          }`}
        >
          {/* Без имени и без глагола в прошедшем времени: «Алексей начал»
              и «Ирина начала» — разные формы, а имя уже стоит выше
              в карточке задания */}
          {assignment.started
            ? "Задание уже начато. Из списка менеджера оно пропадёт, а разговор и расшифровка останутся."
            : "Задание ещё не начинали."}
        </p>

        {error && (
          <p className="mt-3 text-sm text-danger-text">{error}</p>
        )}

        <div className="mt-[22px] flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-line-strong bg-surface-card px-5 py-[11px] text-[15.5px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-[10px] bg-danger-strong px-[22px] py-[11px] text-[15.5px] font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {deleting && <Spinner />}
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
