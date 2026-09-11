"use client";

// Карточка выполненного задания — вдвое ниже активной.
//
// Комментария в ней нет намеренно: комментарий отвечает на «зачем
// тренироваться», а когда тренировка прошла, ответ перестаёт быть новостью.
// На «как получилось» отвечает разбор, поэтому вместо комментария —
// разговор, которым задание закрыли, с оценкой и переходом к расшифровке.
// Полтора десятка таких подряд читаются списком, а не стеной.

import Link from "next/link";
import PatientAvatar from "@/app/components/PatientAvatar";
import ScoreBadge from "@/app/components/ScoreBadge";
import { formatDoneDate, formatDuration, initials } from "@/lib/format";
import type { DoneAssignment } from "@/lib/training";

interface DoneAssignmentCardProps {
  assignment: DoneAssignment;
  /** У руководителя показываем, кто выполнил */
  isHead: boolean;
}

export default function DoneAssignmentCard({
  assignment,
  isHead,
}: DoneAssignmentCardProps) {
  const { conversation } = assignment;

  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-line bg-surface-card px-[18px] py-3.5">
      <span
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-good-surface text-[13px] font-bold text-good"
        aria-hidden="true"
      >
        ✓
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15.5px] font-semibold text-ink">
          {assignment.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
          <span className="whitespace-nowrap">
            выполнено {formatDoneDate(assignment.completedAt)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <PatientAvatar
              name={assignment.patient.name}
              className="h-[18px] w-[18px] bg-brand-soft text-[9px] font-semibold text-brand"
              lazy
            />
            {assignment.patient.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>{assignment.trainingType.title}</span>
        </div>
      </div>

      {isHead && assignment.assignee && (
        <span className="inline-flex shrink-0 items-center gap-2 text-[13px] text-ink-body">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
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
          {assignment.assignee.name}
        </span>
      )}

      {conversation ? (
        <>
          <span className="shrink-0 font-mono text-[13.5px] text-ink-muted">
            {formatDuration(conversation.durationSec)}
          </span>
          <ScoreBadge score={conversation.score} />
          <Link
            href={`/transcript/${conversation.id}`}
            title="Открыть расшифровку"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap py-1 text-[12.5px] font-medium text-brand transition-colors hover:text-brand-hover hover:underline hover:[text-underline-offset:3px]"
          >
            Расшифровка
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </>
      ) : (
        // Разговор отвязали или удалили — задание всё равно выполнено,
        // и молча прятать его из списка было бы неправдой
        <span className="shrink-0 text-[12.5px] text-ink-subtle">
          разговор недоступен
        </span>
      )}
    </div>
  );
}
