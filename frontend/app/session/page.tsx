"use client";

// Экран звонка — главный экран продукта.
// Одна спокойная колонка по центру: максимум внимания к тому, кто сейчас
// на линии. Управляет сессией через REST API и WebSocket, захватывает
// микрофон (PCM 16 кГц) и воспроизводит голосовой ответ ИИ.
//
// Состояния: до старта · соединение · разговор (говорит клиент / слушаю вас)
// · пауза · нет доступа к микрофону · завершение.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CallAvatar from "@/app/components/CallAvatar";
import Logo from "@/app/components/Logo";
import SpeakerPill from "@/app/components/SpeakerPill";
import Timer from "@/app/components/Timer";
import { AudioPlayer, MicRecorder } from "@/lib/voiceClient";

type ScreenState =
  | "idle"
  | "connecting"
  | "active"
  | "paused"
  | "micError"
  | "completing";

interface Patient {
  id: string;
  name: string;
  description: string | null;
  anamnesis: string | null;
}

// Как часто спрашиваем плеер, звучит ли ответ ИИ. Четверти секунды хватает,
// чтобы индикатор переключался незаметно для глаза и не грузил страницу.
const SPEAKER_POLL_MS = 250;

export default function SessionPage() {
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>("idle");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Звучит ли сейчас ответ ИИ — от этого зависит индикатор и вид аватара
  const [aiSpeaking, setAiSpeaking] = useState(false);

  // Ссылки на активные ресурсы разговора
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // Пациент, с которым пойдёт разговор
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/patients/active");
        if (!res.ok) return;
        const data = (await res.json()) as Patient;
        if (!cancelled) setPatient(data);
      } catch {
        // молча: без карточки пациента разговор всё равно можно начать
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Таймер идёт во время разговора; на паузе замирает, но не сбрасывается
  useEffect(() => {
    if (screenState !== "active") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [screenState]);

  // Опрашиваем плеер: говорит ИИ или ждёт нас
  useEffect(() => {
    if (screenState !== "active") {
      setAiSpeaking(false);
      return;
    }
    const id = setInterval(() => {
      setAiSpeaking(playerRef.current?.isPlaying() ?? false);
    }, SPEAKER_POLL_MS);
    return () => clearInterval(id);
  }, [screenState]);

  // Полная очистка ресурсов разговора (микрофон, воспроизведение, сокет)
  const teardown = useCallback(() => {
    void recorderRef.current?.stop();
    recorderRef.current = null;
    playerRef.current?.reset();
    playerRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // Закрываем всё при уходе со страницы
  useEffect(() => teardown, [teardown]);

  // Безопасная отправка сообщения в WebSocket (если соединение открыто)
  function sendWs(message: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // «Начать разговор»: создаём сессию, подключаем WebSocket, микрофон и плеер
  async function handleStart() {
    setBusy(true);
    setErrorMsg("");
    setScreenState("connecting");
    try {
      const res = await fetch("/api/sessions/start", { method: "POST" });
      if (!res.ok) {
        if (res.status === 401) router.push("/login");
        setScreenState("idle");
        return;
      }
      const { sessionId: id, wsUrl } = (await res.json()) as {
        sessionId: string;
        wsUrl: string;
      };

      // Одноразовый ws-токен (основной JWT в httpOnly cookie недоступен из JS)
      const tokenRes = await fetch("/api/auth/ws-token");
      if (!tokenRes.ok) {
        if (tokenRes.status === 401) router.push("/login");
        setErrorMsg("Не удалось авторизовать голосовое соединение");
        setScreenState("idle");
        return;
      }
      const { wsToken } = (await tokenRes.json()) as { wsToken: string };

      setSessionId(id);
      setSeconds(0);

      // Готовим плеер для голосовых ответов ИИ
      playerRef.current = new AudioPlayer();

      // Открываем WebSocket с ws-токеном в query
      const url = `${wsUrl}?token=${encodeURIComponent(wsToken)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // При открытии соединения запрашиваем микрофон и переходим в разговор
      ws.onopen = async () => {
        try {
          const recorder = new MicRecorder();
          recorderRef.current = recorder;
          await recorder.start((base64) => {
            sendWs({ type: "audio_chunk", data: base64 });
          });
          setScreenState("active");
        } catch {
          // Без микрофона разговор невозможен — показываем, как его включить
          setScreenState("micError");
        }
      };

      // Роутинг входящих сообщений сервера
      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case "audio_chunk":
              playerRef.current?.pushChunk(msg.data);
              break;
            case "audio_end":
              playerRef.current?.endUtterance();
              break;
            case "barge_in":
              // Подтверждение сервера: хвост отменённого ответа уже не придёт
              playerRef.current?.confirmInterrupt();
              break;
            case "error":
              setErrorMsg(msg.message || "Ошибка сервера");
              break;
            case "session_ended":
              break;
            // transcript_user / transcript_ai на экране не показываем —
            // полный текст доступен на странице расшифровки после разговора
            default:
              break;
          }
        } catch {
          // некорректное сообщение — игнорируем
        }
      };

      ws.onerror = () => {
        console.warn("Ошибка WebSocket-соединения");
      };
    } finally {
      setBusy(false);
    }
  }

  // «Пауза»: перестаём слать аудио и сообщаем серверу
  function handlePause() {
    recorderRef.current?.pause();
    sendWs({ type: "pause" });
    setScreenState("paused");
  }

  // «Продолжить»: возобновляем отправку аудио
  function handleResume() {
    recorderRef.current?.resume();
    sendWs({ type: "resume" });
    setScreenState("active");
  }

  // «Завершить разговор»: стоп по WS, освобождение ресурсов, переход к расшифровке
  async function handleStop() {
    setBusy(true);
    setScreenState("completing");
    try {
      sendWs({ type: "stop" });
      await recorderRef.current?.stop();
      recorderRef.current = null;
      playerRef.current?.reset();
      playerRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;

      if (sessionId) {
        await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
        router.push(`/transcript/${sessionId}`);
      } else {
        setScreenState("idle");
      }
    } finally {
      setBusy(false);
    }
  }

  // «Выйти»: завершаем сессию авторизации
  async function handleLogout() {
    teardown();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const inCall = screenState === "active" || screenState === "paused";
  const canLeave = screenState === "idle" || screenState === "micError";

  return (
    <main className="flex h-screen flex-col bg-surface-card">
      {/* Топбар: логотип, а справа — таймер во время разговора или выход */}
      <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-line-soft px-8">
        <Logo />

        {inCall && <Timer seconds={seconds} paused={screenState === "paused"} size="lg" />}

        {canLeave && (
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Выйти
          </button>
        )}

        {screenState === "connecting" && (
          <span className="text-sm font-medium text-disabled">Выйти</span>
        )}

        {screenState === "completing" && (
          <span className="font-mono text-[15px] text-ink-subtle">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </span>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-10 py-10">
        {/* --- До старта --- */}
        {screenState === "idle" && (
          <>
            <CallAvatar name={patient?.name ?? null} state="idle" />
            <div className="mt-[18px] text-[22px] font-semibold text-ink">
              {patient?.name ?? "Пациент"}
            </div>
            {patient?.description && (
              <div className="mt-1 text-sm text-ink-muted">
                {patient.description}
              </div>
            )}

            {patient?.anamnesis && (
              <div className="mt-[22px] w-full max-w-[440px] rounded-xl border border-line bg-surface px-[18px] py-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-subtle">
                  Анамнез
                </div>
                <div className="text-sm leading-normal text-ink-label">
                  {patient.anamnesis}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="mt-6 inline-flex items-center gap-2.5 rounded-input bg-brand px-[30px] py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white" />
              Начать разговор
            </button>
            <div className="mt-3 text-[12.5px] text-ink-subtle">
              Понадобится доступ к микрофону
            </div>
          </>
        )}

        {/* --- Соединение --- */}
        {screenState === "connecting" && (
          <>
            <div className="relative flex h-[120px] w-[120px] items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
              <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-brand-soft text-[34px] font-semibold text-brand opacity-70">
                {patient?.name ? patient.name.slice(0, 1) : "—"}
              </div>
            </div>
            <div className="mt-5 text-xl font-semibold text-ink">Подключаемся…</div>
            <div className="mt-5 flex w-full max-w-[440px] items-start gap-3 rounded-xl border border-[#BCD8D3] bg-brand-soft px-4 py-3.5">
              <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-brand text-[13px] text-white">
                🎙
              </span>
              <div className="text-[13.5px] leading-snug text-brand-hover">
                Разрешите доступ к микрофону в окне браузера, чтобы начать
                разговор.
              </div>
            </div>
          </>
        )}

        {/* --- Разговор и пауза --- */}
        {inCall && (
          <>
            <CallAvatar
              name={patient?.name ?? null}
              size="lg"
              state={
                screenState === "paused"
                  ? "paused"
                  : aiSpeaking
                    ? "speaking"
                    : "listening"
              }
            />
            <div className="mt-[30px] text-[30px] font-semibold text-ink">
              {patient?.name ?? "Пациент"}
            </div>
            <div className="mt-3">
              <SpeakerPill
                size="lg"
                state={
                  screenState === "paused"
                    ? "paused"
                    : aiSpeaking
                      ? "speaking"
                      : "listening"
                }
              />
            </div>

            {errorMsg && (
              <p className="mt-4 max-w-[440px] text-center text-sm text-danger-text">
                {errorMsg}
              </p>
            )}

            <div className="mt-10 flex gap-3.5">
              {screenState === "active" ? (
                <button
                  type="button"
                  onClick={handlePause}
                  disabled={busy}
                  className="rounded-input-lg border border-line-strong bg-white px-8 py-[15px] text-base font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed"
                >
                  Пауза
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={busy}
                  className="rounded-input-lg bg-brand px-8 py-[15px] text-base font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed"
                >
                  Продолжить
                </button>
              )}

              <button
                type="button"
                onClick={handleStop}
                disabled={busy}
                className={`rounded-input-lg px-8 py-[15px] text-base font-semibold transition-colors disabled:cursor-not-allowed ${
                  screenState === "paused"
                    ? "border border-[#E3C9C6] bg-white text-danger hover:bg-danger-wash"
                    : "bg-danger text-white hover:bg-danger/90"
                }`}
              >
                Завершить разговор
              </button>
            </div>
          </>
        )}

        {/* --- Нет доступа к микрофону --- */}
        {screenState === "micError" && (
          <>
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-danger-border bg-danger-surface text-[40px] text-danger">
              🎙
            </div>
            <div className="mt-[18px] text-[21px] font-semibold text-ink">
              Нет доступа к микрофону
            </div>
            <p className="mt-2 max-w-[420px] text-center text-[14.5px] leading-normal text-ink-muted">
              Браузер заблокировал микрофон. Разрешите доступ в настройках сайта
              и повторите — без него разговор не начнётся.
            </p>
            <div className="mt-5 w-full max-w-[440px] rounded-xl border border-line bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-ink-label">
              1. Нажмите на значок 🔒 слева от адреса
              <br />
              2. Включите «Микрофон»
              <br />
              3. Вернитесь и нажмите «Повторить»
            </div>
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="mt-6 rounded-input bg-brand px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
            >
              Повторить
            </button>
          </>
        )}

        {/* --- Завершение --- */}
        {screenState === "completing" && (
          <>
            <div className="relative flex h-[88px] w-[88px] items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
              <span className="text-3xl text-brand">✓</span>
            </div>
            <div className="mt-[22px] text-[21px] font-semibold text-ink">
              Разговор завершён
            </div>
            <div className="mt-1.5 text-[14.5px] text-ink-muted">
              Готовим расшифровку…
            </div>
          </>
        )}
      </div>
    </main>
  );
}
