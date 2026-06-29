"use client";

// Главный экран тренажёра.
// Три состояния: idle (до старта), active (идёт разговор), paused (пауза).
// Управляет сессией через REST API и устанавливает WebSocket-соединение
// (на этом этапе — без обработки аудио, только соединение и команды).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CallAvatar from "@/app/components/CallAvatar";
import Timer from "@/app/components/Timer";
import Button from "@/app/components/Button";

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

  // Ссылка на активное WebSocket-соединение
  const wsRef = useRef<WebSocket | null>(null);

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

  // Закрываем WebSocket при размонтировании страницы
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Безопасная отправка сообщения в WebSocket (если соединение открыто)
  function sendWs(message: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // "Начать разговор": создаём сессию и подключаемся к WebSocket
  async function handleStart() {
    setBusy(true);
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

      setSessionId(id);
      setSeconds(0);
      setScreenState("active");

      // Получаем одноразовый ws-токен (основной JWT в httpOnly cookie
      // недоступен из JS), затем подключаемся к WebSocket с ним в query.
      try {
        const tokenRes = await fetch("/api/auth/ws-token");
        if (!tokenRes.ok) {
          if (tokenRes.status === 401) router.push("/login");
          throw new Error("Не удалось получить ws-токен");
        }
        const { wsToken } = (await tokenRes.json()) as { wsToken: string };

        const url = `${wsUrl}?token=${encodeURIComponent(wsToken)}`;
        const ws = new WebSocket(url);
        ws.onerror = () => {
          console.warn("Ошибка WebSocket-соединения:", wsUrl);
        };
        wsRef.current = ws;
      } catch (err) {
        console.warn("Не удалось открыть WebSocket:", err);
      }
    } finally {
      setBusy(false);
    }
  }

  // "Пауза": сообщаем серверу и останавливаем таймер
  function handlePause() {
    sendWs({ type: "pause" });
    setScreenState("paused");
  }

  // "Продолжить": возобновляем разговор
  function handleResume() {
    sendWs({ type: "resume" });
    setScreenState("active");
  }

  // "Завершить разговор": стоп по WS + завершение сессии в API + переход к транскрипту
  async function handleStop() {
    setBusy(true);
    try {
      sendWs({ type: "stop" });
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
