"use client";

// Расшифровка завершённого разговора: диалог слева, разбор справа.
// Открывается сразу после звонка и из списка разговоров на главной.
// Своя топ-панель вместо бокового меню — как на экране звонка.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Alert from "@/app/components/Alert";
import Button from "@/app/components/Button";
import ReviewPanel from "@/app/components/ReviewPanel";
import TranscriptMessage from "@/app/components/TranscriptMessage";
import Spinner from "@/app/components/Spinner";
import { formatConversationDate, formatDuration, initials } from "@/lib/format";
import { messageOffsetSec, type TranscriptData } from "@/lib/transcript";

export default function TranscriptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [data, setData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/transcript`);
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/login");
            return;
          }
          if (!cancelled) {
            setError(
              res.status === 404
                ? "Разговор не найден"
                : "Не удалось загрузить расшифровку"
            );
          }
          return;
        }
        const payload = (await res.json()) as TranscriptData;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Не удалось загрузить расшифровку");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  const session = data?.session;
  const managerName = data
    ? `${data.manager.firstName} ${data.manager.lastName}`.trim() || null
    : null;

  // Пациент и тема в одну строку: у старых разговоров может не быть ни того,
  // ни другого — тогда показываем нейтральный заголовок
  const title =
    [session?.patientName, session?.topic].filter(Boolean).join(" · ") ||
    "Разговор";

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-surface-card px-10">
        <div className="flex items-center gap-3.5">
          <Link
            href="/"
            className="text-sm text-ink-muted transition-colors hover:text-brand-hover"
          >
            ← Назад
          </Link>

          {session && (
            <>
              <span className="h-5 w-px bg-line" aria-hidden="true" />
              <div className="flex items-center gap-2.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                  {initials(session.patientName)}
                </span>
                <div>
                  <div className="text-sm font-semibold leading-tight text-ink">
                    {title}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {formatConversationDate(session.startedAt)} ·{" "}
                    {formatDuration(session.durationSec)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2.5">
          {/* Выгрузки пока нет — кнопка на месте по макету, но неактивна */}
          <Button
            variant="secondary"
            disabled
            title="Скоро"
            className="px-4 py-2 text-[13.5px]"
          >
            Скачать
          </Button>
          <Button
            onClick={() => router.push("/session")}
            className="px-4 py-2 text-[13.5px]"
          >
            Ещё разговор
          </Button>
        </div>
      </header>

      {loading && (
        <div className="flex flex-1 items-center justify-center text-ink-muted">
          <Spinner />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-1 items-start justify-center px-10 pt-16">
          <Alert className="max-w-md">{error}</Alert>
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex w-full min-h-0 max-w-[1440px] flex-1 self-center">
          <div className="min-h-0 flex-[1.7] overflow-y-auto border-r border-line px-9 py-8">
            <div className="mb-6 text-center">
              <span className="rounded-full bg-surface-bubble px-3 py-1 font-mono text-[11px] tracking-wide text-ink-placeholder">
                НАЧАЛО · 00:00
              </span>
            </div>

            {data.messages.length === 0 && (
              <p className="text-center text-sm text-ink-muted">
                В этом разговоре не осталось реплик.
              </p>
            )}

            {data.messages.map((message, index) => {
              const isManager = message.role === "user";
              return (
                <TranscriptMessage
                  key={index}
                  isManager={isManager}
                  text={message.text}
                  speakerName={isManager ? managerName : session?.patientName ?? null}
                  offsetSec={messageOffsetSec(
                    data.session.startedAt,
                    message.createdAt
                  )}
                />
              );
            })}
          </div>

          <ReviewPanel review={data.review} />
        </div>
      )}
    </div>
  );
}
