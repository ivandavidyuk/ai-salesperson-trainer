"use client";

// Экран звонка — главный экран продукта.
// Одна спокойная колонка по центру: максимум внимания к тому, кто сейчас
// на линии. Управляет сессией через REST API и WebSocket, захватывает
// микрофон (PCM 16 кГц) и воспроизводит голосовой ответ ИИ.
//
// Состояния: до старта · соединение · разговор (говорит клиент / слушаю вас)
// · пауза · нет доступа к микрофону · завершение.

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AudioDevicePicker from "@/app/components/AudioDevicePicker";
import BackLink from "@/app/components/BackLink";
import CallAvatar from "@/app/components/CallAvatar";
import Logo from "@/app/components/Logo";
import SpeakerPill from "@/app/components/SpeakerPill";
import Timer from "@/app/components/Timer";
import { AudioPlayer, MicRecorder } from "@/lib/voiceClient";
import {
  listDevices,
  micErrorText,
  onDevicesChanged,
  saveInputId,
  saveOutputId,
  savedInputId,
  savedOutputId,
  type AudioDevice,
} from "@/lib/audioDevices";

// Порог голоса — тот же, что на бэкенде (_MIN_VOICE_RMS в services/stt.py)
const VOICE_RMS = 500;

// Порог «хоть какой-то сигнал». Живой микрофон даже в тихой комнате даёт
// шум в несколько десятков; ровный ноль — это отключённый вход.
const SIGNAL_RMS = 15;

// Два разных случая, и спешить в них нужно по-разному.
// Полная тишина — устройство мертво, ошибиться тут почти невозможно.
const NO_SIGNAL_MS = 5_000;
// Сигнал есть, но до голоса не дотягивает — микрофон работает, просто тихо.
// Тут спешить нельзя: человек мог просто задуматься.
const TOO_QUIET_MS = 20_000;

type MicAlert = "no-signal" | "too-quiet" | null;

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

// useSearchParams требует границы Suspense, иначе страница не соберётся
// статически. Сам экран — во вложенном компоненте.
export default function SessionPage() {
  return (
    <Suspense>
      <SessionScreen />
    </Suspense>
  );
}

function SessionScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Параметры из мастера настройки. Их может не быть: на /session можно
  // зайти напрямую — тогда работает прежний путь с активным пациентом.
  const chosenPatientId = searchParams.get("patient");
  const chosenType = searchParams.get("type");
  // Задание, по которому запущен разговор: закроется при завершении
  const assignmentId = searchParams.get("assignment");

  const [screenState, setScreenState] = useState<ScreenState>("idle");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Звучит ли сейчас ответ ИИ — от этого зависит индикатор и вид аватара
  const [aiSpeaking, setAiSpeaking] = useState(false);
  // Та же величина ссылкой: сторож тишины опрашивает её из интервала,
  // и пересоздавать интервал на каждое переключение речи незачем
  const aiSpeakingRef = useRef(false);

  // Ссылки на активные ресурсы разговора
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // --- Аудио-устройства -----------------------------------------------------
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [inputId, setInputId] = useState<string | null>(savedInputId());
  const [outputId, setOutputId] = useState<string | null>(savedOutputId());
  const [micHint, setMicHint] = useState("");
  // Новому пользователю показываем списки сразу: он ещё ничего не выбирал.
  // Тому, кто уже настроил, — свёрнутую строку.
  const [settingsOpen, setSettingsOpen] = useState(() => savedInputId() === null);
  // Громкость последнего блока и момент, когда в неё последний раз попал голос
  const [level, setLevel] = useState(0);
  const lastVoiceAtRef = useRef(Date.now());
  const lastSoundAtRef = useRef(Date.now());
  const [micAlert, setMicAlert] = useState<MicAlert>(null);
  // Проверочный захват на экране до разговора
  const previewRef = useRef<MicRecorder | null>(null);

  const noteLevel = useCallback((rms: number) => {
    setLevel(rms);
    const now = Date.now();
    // Сигнал и голос отмечаем раздельно: по их сочетанию сторож различает
    // мёртвое устройство и просто тихий микрофон
    if (rms >= SIGNAL_RMS) lastSoundAtRef.current = now;
    if (rms >= VOICE_RMS) {
      lastVoiceAtRef.current = now;
      setMicAlert(null);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const { inputs: ins, outputs: outs } = await listDevices();
    setInputs(ins);
    setOutputs(outs);
  }, []);

  // Пациент, с которым пойдёт разговор: либо выбранный в мастере,
  // либо первый активный при прямом заходе на страницу
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (chosenPatientId) {
          const res = await fetch("/api/patients");
          if (!res.ok) return;
          const list = (await res.json()) as Patient[];
          const found = list.find((item) => item.id === chosenPatientId);
          if (found && !cancelled) {
            setPatient(found);
            return;
          }
        }
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
  }, [chosenPatientId]);

  // Проверочный захват на экране подготовки: человек видит, какое устройство
  // его слушает и слышат ли его, ещё до начала разговора. Именно здесь
  // вскрывается случай, когда браузер молча выбрал не тот вход.
  useEffect(() => {
    if (screenState !== "idle") return;

    let cancelled = false;
    const recorder = new MicRecorder();

    (async () => {
      try {
        await recorder.start(() => {}, {
          deviceId: savedInputId(),
          onLevel: (rms) => {
            if (!cancelled) noteLevel(rms);
          },
          // Сохранённого устройства больше нет — забываем его, чтобы
          // не спотыкаться о него при каждом заходе
          onDeviceMissing: () => {
            saveInputId(null);
            setInputId(null);
          },
        });
        if (cancelled) {
          await recorder.stop();
          return;
        }
        previewRef.current = recorder;
        setMicHint("");
        // Подписи устройств появляются только после выданного разрешения
        await refreshDevices();
      } catch (error) {
        if (!cancelled) setMicHint(micErrorText(error));
      }
    })();

    return () => {
      cancelled = true;
      // Останавливаем именно текущий захват: смена микрофона заменяет его
      // на новый, и остановка исходного оставила бы устройство занятым
      const active = previewRef.current ?? recorder;
      previewRef.current = null;
      void active.stop();
    };
  }, [screenState, noteLevel, refreshDevices]);

  // Устройства втыкают и вынимают прямо во время работы
  useEffect(() => onDevicesChanged(() => void refreshDevices()), [refreshDevices]);

  // Сторож тишины: если микрофон долго не слышит ничего, человек об этом
  // узнает сразу, а не через десять минут разговора с пустотой
  useEffect(() => {
    if (screenState !== "active") {
      setMicAlert(null);
      return;
    }
    lastVoiceAtRef.current = Date.now();
    lastSoundAtRef.current = Date.now();

    const id = setInterval(() => {
      const now = Date.now();
      // Пока говорит ИИ, менеджер молчит по делу — иначе плашка вылезала бы
      // на длинном ответе
      if (aiSpeakingRef.current) {
        lastVoiceAtRef.current = now;
        lastSoundAtRef.current = now;
        return;
      }
      if (now - lastSoundAtRef.current > NO_SIGNAL_MS) {
        setMicAlert("no-signal");
      } else if (now - lastVoiceAtRef.current > TOO_QUIET_MS) {
        setMicAlert("too-quiet");
      } else {
        setMicAlert(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [screenState]);

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
      aiSpeakingRef.current = false;
      return;
    }
    const id = setInterval(() => {
      const speaking = playerRef.current?.isPlaying() ?? false;
      setAiSpeaking(speaking);
      aiSpeakingRef.current = speaking;
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

  // «Начать тренировку»: создаём сессию, подключаем WebSocket, микрофон и плеер
  async function handleStart() {
    setBusy(true);
    setErrorMsg("");
    setScreenState("connecting");
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: chosenPatientId ?? undefined,
          trainingType: chosenType ?? undefined,
          assignmentId: assignmentId ?? undefined,
        }),
      });
      if (!res.ok) {
        if (res.status === 401) router.push("/login");
        // 400 — выбранный пациент или тип недоступен: объясняем, а не молчим
        if (res.status === 400) {
          setErrorMsg("Этот вариант тренировки пока недоступен");
        }
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
      playerRef.current.setOutputDevice(outputId);

      // Проверочный захват больше не нужен — освобождаем устройство,
      // иначе на разговор пойдёт второй параллельный захват
      if (previewRef.current) {
        await previewRef.current.stop();
        previewRef.current = null;
      }

      // Открываем WebSocket с ws-токеном в query
      const url = `${wsUrl}?token=${encodeURIComponent(wsToken)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // При открытии соединения запрашиваем микрофон и переходим в разговор
      ws.onopen = async () => {
        try {
          const recorder = new MicRecorder();
          recorderRef.current = recorder;
          await recorder.start(
            (base64) => sendWs({ type: "audio_chunk", data: base64 }),
            {
              deviceId: inputId,
              onLevel: noteLevel,
              onDeviceMissing: () => {
                saveInputId(null);
                setInputId(null);
              },
            }
          );
          setScreenState("active");
        } catch (error) {
          // Без микрофона разговор невозможен — показываем причину отказа,
          // а не общий экран, из которого ничего не понять
          setMicHint(micErrorText(error));
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
        // replace, а не push: разговор уже завершён, и возвращаться на этот
        // экран бессмысленно — он поднялся бы в исходном состоянии и предложил
        // начать заново, создав новый разговор. «Назад» с расшифровки должно
        // уводить туда, откуда пришли запускать тренировку.
        router.replace(`/transcript/${sessionId}`);
      } else {
        setScreenState("idle");
      }
    } finally {
      setBusy(false);
    }
  }


  /**
   * Смена микрофона. До разговора переоткрываем проверочный захват,
   * во время — только захват, не трогая ни WebSocket, ни саму сессию:
   * человек не должен терять разговор из-за не того устройства.
   */
  const changeInput = useCallback(
    async (id: string) => {
      saveInputId(id);
      setInputId(id);
      setLevel(0);
      lastVoiceAtRef.current = Date.now();
      lastSoundAtRef.current = Date.now();
      setMicAlert(null);

      const restart = async (recorder: MicRecorder | null, live: boolean) => {
        if (!recorder) return;
        await recorder.stop();
        const next = new MicRecorder();
        await next.start(
          live
            ? (base64) => sendWs({ type: "audio_chunk", data: base64 })
            : () => {},
          { deviceId: id, onLevel: noteLevel }
        );
        if (live) recorderRef.current = next;
        else previewRef.current = next;
      };

      try {
        if (screenState === "active" || screenState === "paused") {
          await restart(recorderRef.current, true);
        } else {
          await restart(previewRef.current, false);
        }
        setMicHint("");
      } catch (error) {
        setMicHint(micErrorText(error));
      }
    },
    [screenState, noteLevel]
  );

  // Подпись текущего микрофона для свёрнутой строки. Пока разрешение не
  // выдано, подписей у устройств нет — тогда говорим нейтрально.
  const currentInputLabel =
    inputs.find((device) => device.id === inputId)?.label ??
    inputs[0]?.label ??
    "Микрофон по умолчанию";

  const changeOutput = useCallback((id: string) => {
    saveOutputId(id);
    setOutputId(id);
    playerRef.current?.setOutputDevice(id);
  }, []);

  const inCall = screenState === "active" || screenState === "paused";
  const canLeave = screenState === "idle" || screenState === "micError";

  return (
    <main className="flex h-screen flex-col bg-surface-card">
      {/* Топбар: логотип и «Назад», справа — таймер во время разговора.
          Высота и отступы те же, что в AppShell: экран разговора выпадает
          из общей оболочки, но выглядеть должен её продолжением. */}
      <header className="flex h-[66px] shrink-0 items-center justify-between border-b border-line bg-surface-card px-7">
        <div className="flex items-center gap-3.5">
          <Link href="/" title="На главную" className="shrink-0">
            <Logo size="sm" />
          </Link>
          {/* Уйти можно только до начала разговора: во время него переход
              оборвал бы живую сессию, поэтому ссылки там нет */}
          {canLeave && (
            <>
              <span className="h-5 w-px bg-line" aria-hidden="true" />
              <BackLink />
            </>
          )}
        </div>

        {inCall && <Timer seconds={seconds} paused={screenState === "paused"} size="lg" />}

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

            {/* Проверка устройств до разговора. Свёрнута до одной строки:
                постоянные два списка перед каждым звонком быстро надоели бы.
                Но полоска уровня видна всегда — ради неё всё и делалось,
                а спрятанную за кнопку проверку никто бы не открывал */}
            <div className="mt-[22px] w-full max-w-[440px] rounded-xl border border-line bg-surface px-[18px] py-4">
              {settingsOpen ? (
                <AudioDevicePicker
                  inputs={inputs}
                  inputId={inputId}
                  onInputChange={changeInput}
                  outputs={outputs}
                  outputId={outputId}
                  onOutputChange={changeOutput}
                  level={level}
                  heard={level >= VOICE_RMS}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink-body">
                      {currentInputLabel}
                    </div>
                    <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <div
                        style={{
                          width: `${Math.min(100, Math.round((level / 4000) * 100))}%`,
                        }}
                        className={`h-full rounded-full transition-[width] duration-75 ${
                          level >= VOICE_RMS ? "bg-brand" : "bg-brand-sparkline"
                        }`}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="shrink-0 text-[13.5px] font-semibold text-brand transition-colors hover:text-brand-hover"
                  >
                    Настроить
                  </button>
                </div>
              )}
              {micHint && (
                <p className="mt-3 text-[12.5px] leading-normal text-danger-text">
                  {micHint}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="mt-6 inline-flex items-center gap-2.5 rounded-input bg-brand px-[30px] py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white" />
              Начать тренировку
            </button>
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

            {/* Разговор идёт и выглядит рабочим, а микрофон молчит. Без этой
                плашки человек узнавал бы о проблеме через десять минут */}
            {micAlert && (
              <div className="mt-6 w-full max-w-[440px] rounded-xl border border-warn-border bg-warn-surface px-[18px] py-4">
                <div className="text-sm font-semibold text-warn">
                  {micAlert === "no-signal"
                    ? "Микрофон не даёт сигнала"
                    : "Вас плохо слышно"}
                </div>
                <p className="mt-1 text-[13px] leading-normal text-ink-body">
                  {micAlert === "no-signal"
                    ? "Похоже, выбрано не то устройство: звука нет совсем. Переключите микрофон — разговор не прервётся."
                    : "Звук есть, но слишком тихий для распознавания. Говорите громче, придвиньтесь к микрофону или прибавьте его громкость в настройках системы."}
                </p>
                {/* Список нужен только когда устройство молчит: при тихом
                    сигнале менять его незачем, дело в громкости */}
                {micAlert === "no-signal" && (
                  <div className="mt-3.5">
                    <AudioDevicePicker
                      compact
                      inputs={inputs}
                      inputId={inputId}
                      onInputChange={changeInput}
                      outputs={[]}
                      outputId={outputId}
                      onOutputChange={changeOutput}
                      level={level}
                      heard={level >= VOICE_RMS}
                    />
                  </div>
                )}
              </div>
            )}

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
              Микрофон не включился
            </div>
            {/* Причина, а не догадка: раньше любой сбой выглядел как запрет
                браузера, хотя устройство могло быть занято или отсутствовать */}
            <p className="mt-2 max-w-[420px] text-center text-[14.5px] leading-normal text-ink-muted">
              {micHint ||
                "Не удалось включить микрофон. Проверьте устройство и попробуйте снова."}
            </p>
            <div className="mt-5 w-full max-w-[440px] rounded-xl border border-line bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-ink-label">
              Если доступ заблокирован браузером:
              <br />
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
