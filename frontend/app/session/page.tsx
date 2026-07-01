"use client";

// Главный экран тренажёра.
// Три состояния: idle (до старта), active (идёт разговор), paused (пауза).
// Управляет сессией через REST API и WebSocket, захватывает микрофон
// (PCM 16 кГц) и воспроизводит голосовой ответ ИИ.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CallAvatar from "@/app/components/CallAvatar";
import Timer from "@/app/components/Timer";
import Button from "@/app/components/Button";
import { AudioPlayer, MicRecorder } from "@/app/lib/voiceClient";

type ScreenState = "idle" | "active" | "paused";

interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export default function SessionPage() {
  const router = useRouter();

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Ссылки на активные ресурсы разговора
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // Загружаем данные текущего пользователя при монтировании
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = (await res.json()) as CurrentUser;
        if (!cancelled) setUser(data);
      } catch {
        router.push("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Таймер: идёт только в состоянии active
  useEffect(() => {
    if (screenState !== "active") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [screenState]);

  // Полная очистка ресурсов разговора (микрофон, воспроизведение, сокет)
  function teardown() {
    void recorderRef.current?.stop();
    recorderRef.current = null;
    playerRef.current?.reset();
    playerRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }

  // Закрываем всё при размонтировании страницы
  useEffect(() => {
    return () => {
      teardown();
    };
  }, []);

  // Безопасная отправка сообщения в WebSocket (если соединение открыто)
  function sendWs(message: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // "Начать разговор": создаём сессию, подключаем WebSocket, микрофон и плеер
  async function handleStart() {
    setBusy(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/sessions/start", { method: "POST" });
      if (!res.ok) {
        if (res.status === 401) router.push("/login");
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
        return;
      }
      const { wsToken } = (await tokenRes.json()) as { wsToken: string };

      setSessionId(id);
      setSeconds(0);

      // Готовим плеер для голосовых ответов ИИ
      const player = new AudioPlayer();
      playerRef.current = player;

      // Открываем WebSocket с ws-токеном в query
      const url = `${wsUrl}?token=${encodeURIComponent(wsToken)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // При открытии соединения переходим в active и запускаем микрофон
      ws.onopen = async () => {
        setScreenState("active");
        try {
          const recorder = new MicRecorder();
          recorderRef.current = recorder;
          await recorder.start((base64) => {
            sendWs({ type: "audio_chunk", data: base64 });
          });
        } catch {
          setErrorMsg(
            "Нет доступа к микрофону. Разрешите доступ в браузере и начните заново."
          );
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
            case "error":
              setErrorMsg(msg.message || "Ошибка сервера");
              break;
            case "session_ended":
              break;
            // transcript_user / transcript_ai на экране не показываем —
            // полный текст доступен на странице транскрипта после разговора
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

  // "Пауза": перестаём слать аудио и сообщаем серверу
  function handlePause() {
    recorderRef.current?.pause();
    sendWs({ type: "pause" });
    setScreenState("paused");
  }

  // "Продолжить": возобновляем отправку аудио
  function handleResume() {
    recorderRef.current?.resume();
    sendWs({ type: "resume" });
    setScreenState("active");
  }

  // "Завершить разговор": стоп по WS, освобождение ресурсов, переход к транскрипту
  async function handleStop() {
    setBusy(true);
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
      }
    } finally {
      setBusy(false);
    }
  }

  // "Выйти": завершаем сессию авторизации
  async function handleLogout() {
    teardown();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <main className="flex min-h-screen flex-col bg-gray-50">
      {/* Верхняя панель: имя пользователя */}
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-gray-600">
          {user ? user.name : "Загрузка…"}
        </span>
        {screenState === "idle" && (
          <Button variant="secondary" onClick={handleLogout} className="px-4 py-2 text-sm">
            Выйти
          </Button>
        )}
      </header>

      {/* Центральная область */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <CallAvatar pulsing={screenState === "active"} />

        {/* Таймер показываем во время разговора и на паузе */}
        {screenState !== "idle" && <Timer seconds={seconds} />}

        {/* Сообщение об ошибке (микрофон/сервер) */}
        {errorMsg && (
          <p className="max-w-md text-center text-sm text-red-600">{errorMsg}</p>
        )}

        {/* Кнопки управления в зависимости от состояния */}
        <div className="flex gap-4">
          {screenState === "idle" && (
            <Button onClick={handleStart} disabled={busy}>
              Начать разговор
            </Button>
          )}

          {screenState === "active" && (
            <>
              <Button variant="secondary" onClick={handlePause} disabled={busy}>
                Пауза
              </Button>
              <Button variant="danger" onClick={handleStop} disabled={busy}>
                Завершить разговор
              </Button>
            </>
          )}

          {screenState === "paused" && (
            <>
              <Button onClick={handleResume} disabled={busy}>
                Продолжить
              </Button>
              <Button variant="danger" onClick={handleStop} disabled={busy}>
                Завершить разговор
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
