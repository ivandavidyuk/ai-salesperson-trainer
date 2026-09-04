"use client";

// Расшифровка завершённого разговора: диалог слева, разбор справа.
// Открывается сразу после звонка и из списка разговоров на главной.
// Своя топ-панель вместо бокового меню — как на экране звонка.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Alert from "@/app/components/Alert";
import Button from "@/app/components/Button";
import ReviewPanel from "@/app/components/ReviewPanel";
import TranscriptMessage from "@/app/components/TranscriptMessage";
import CaseServiceBlock from "@/app/components/CaseServiceBlock";
import PatientAvatar from "@/app/components/PatientAvatar";
import BackLink from "@/app/components/BackLink";
import Logo from "@/app/components/Logo";
import Loader from "@/app/components/Loader";
import { formatConversationDate, formatDuration } from "@/lib/format";
import { messageOffsetSec, type TranscriptData } from "@/lib/transcript";
import type { CaseService } from "@/lib/caseService";

// Сколько ждать разбор после конца разговора. Оценщик укладывается
// в 3–4 секунды, но у него три попытки с паузами при отказе провайдера,
// поэтому запас щедрый. Дальше ждать нечего: значит разбор не состоялся.
const REVIEW_WAIT_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
// Сколько держать подсветку реплики после «показать в диалоге»: достаточно,
// чтобы глаз нашёл её после прокрутки, и мало, чтобы не выглядеть выделением
const HIGHLIGHT_MS = 1800;

/** Ждём ли ещё разбор: разговор закончился недавно, а разбора нет. */
function reviewExpected(data: TranscriptData | null): boolean {
  if (!data || data.review) return false;
  // Без endedAt сессию никто не закрыл штатно — разбор не запускался
  if (!data.session.endedAt) return false;
  // Без единой реплики разбирать нечего: оценщик на пустую историю
  // не зовётся вовсе (backend: review_conversation), и две минуты
  // «Оценщик читает расшифровку» здесь были бы обещанием впустую
  if (data.messages.length === 0) return false;
  return Date.now() - new Date(data.session.endedAt).getTime() < REVIEW_WAIT_MS;
}

/**
 * Плашка «менеджеру показан результат диагностики» внутри диалога — там,
 * где документ открыли. Услуга над документом одной тихой строкой: разговор
 * уже прошёл, здесь она контекст, а не подсказка, — но без неё по разбору
 * не понять, что вообще было на столе.
 */
function DiagnosticsShownBlock({
  text,
  service,
  className = "",
}: {
  text: string;
  service: CaseService | null;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto max-w-[520px] rounded-xl border border-line bg-surface px-[18px] py-4 ${className}`}
    >
      <div className="mb-2 text-[12.5px] font-semibold uppercase tracking-[.08em] text-ink-subtle">
        Менеджеру показан результат диагностики
      </div>
      <CaseServiceBlock service={service} variant="line" />
      <div className="whitespace-pre-line border-t border-line pt-3 font-mono text-[14px] leading-relaxed text-ink-label">
        {text}
      </div>
    </div>
  );
}

export default function TranscriptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [data, setData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Перерисовка по таймеру: без неё окно ожидания истекает молча, и лоадер
  // крутился бы вечно, пока пользователь не тронет страницу
  const [, setTick] = useState(0);
  // Реплика, к которой панель разбора попросила прокрутить: подсвечена
  // ненадолго, повторный клик по другой цитате переносит подсветку
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showMessage = useCallback((index: number) => {
    document
      .getElementById(`msg-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(index);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
  }, []);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
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
        if (cancelled) return;
        setData(payload);

        // Разбор приходит фоновой задачей уже после того, как страница
        // открылась: перезапрашиваем, пока он не появится
        if (reviewExpected(payload)) {
          timer = setTimeout(() => {
            setTick((value) => value + 1);
            void load();
          }, POLL_INTERVAL_MS);
        }
      } catch {
        // Сетевой сбой на опросе не должен затирать уже показанную
        // расшифровку — ошибку показываем только на первой загрузке
        if (!cancelled && !data) setError("Не удалось загрузить расшифровку");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // data намеренно не в зависимостях: он меняется на каждом опросе,
    // и эффект перезапускался бы сам на себя
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, router]);

  const pendingReview = reviewExpected(data);
  const noMessages = data !== null && data.messages.length === 0;

  // «Ещё разговор» — повторить того же пациента тем же типом тренировки:
  // после разбора человек хочет отыграть заново с тем же собеседником.
  // Раньше кнопка вела на /session без параметров, а страница брала
  // «первого активного» — то есть с любой расшифровки всегда к Тамаре.
  // У сессий до мастера настройки id нет — тогда как прежде, на /session
  const repeatHref = (() => {
    if (!data?.session.patientId) return "/session";
    const params = new URLSearchParams({ patient: data.session.patientId });
    if (data.session.trainingTypeId) params.set("type", data.session.trainingTypeId);
    return `/session?${params.toString()}`;
  })();

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
      <header className="flex h-[66px] shrink-0 items-center justify-between border-b border-line bg-surface-card px-10">
        <div className="flex items-center gap-3.5">
          <Link href="/" title="На главную" className="shrink-0">
            <Logo size="sm" />
          </Link>
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          <BackLink />

          {session && (
            <>
              <span className="h-5 w-px bg-line" aria-hidden="true" />
              <div className="flex items-center gap-2.5">
                <PatientAvatar
                  name={session.patientName}
                  className="h-[30px] w-[30px] bg-brand-soft text-xs font-semibold text-brand"
                />
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
            className="px-4 py-2 text-[15px]"
          >
            Скачать
          </Button>
          <Button
            onClick={() => router.push(repeatHref)}
            className="px-4 py-2 text-[15px]"
          >
            Ещё разговор
          </Button>
        </div>
      </header>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-1 items-start justify-center px-10 pt-16">
          <Alert className="max-w-md">{error}</Alert>
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex w-full min-h-0 max-w-[1760px] flex-1 self-center">
          <div className="min-h-0 flex-[1.7] overflow-y-auto border-r border-line px-9 py-8">
            <div className="mb-6 text-center">
              <span className="rounded-full bg-surface-bubble px-3 py-1 font-mono text-[12.5px] tracking-wide text-ink-placeholder">
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
              // Плашка документа диагностики встаёт перед первой репликой,
              // созданной после показа: середина разговора ссылается на
              // документ, и читатель должен увидеть его там, где менеджер
              const показДо =
                data.session.diagnosticsResult &&
                data.session.diagnosticsShownAt &&
                message.createdAt >= data.session.diagnosticsShownAt &&
                (index === 0 ||
                  data.messages[index - 1].createdAt < data.session.diagnosticsShownAt);
              return (
                // id — якорь для «показать в диалоге» из панели разбора:
                // индекс тот же, что в чек-листе (msg)
                <div key={index} id={`msg-${index}`}>
                  {показДо && (
                    <DiagnosticsShownBlock
                      text={data.session.diagnosticsResult ?? ""}
                      service={data.session.diagnosticsService}
                      className="mb-5"
                    />
                  )}
                  <TranscriptMessage
                    isManager={isManager}
                    text={message.text}
                    speakerName={isManager ? managerName : session?.patientName ?? null}
                    offsetSec={messageOffsetSec(
                      data.session.startedAt,
                      message.createdAt
                    )}
                    highlighted={highlighted === index}
                  />
                </div>
              );
            })}

            {/* Показ случился после последней реплики — плашка в конце */}
            {data.session.diagnosticsResult &&
              data.session.diagnosticsShownAt &&
              (data.messages.length === 0 ||
                data.messages[data.messages.length - 1].createdAt <
                  data.session.diagnosticsShownAt) && (
                <DiagnosticsShownBlock
                  text={data.session.diagnosticsResult ?? ""}
                  service={data.session.diagnosticsService}
                />
              )}
          </div>

          <ReviewPanel
            review={data.review}
            pending={pendingReview}
            emptyReason={noMessages ? "no-messages" : undefined}
            messages={data.messages}
            startedAt={data.session.startedAt}
            onShowMessage={showMessage}
          />
        </div>
      )}
    </div>
  );
}
