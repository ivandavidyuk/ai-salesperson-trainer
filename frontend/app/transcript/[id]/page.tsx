"use client";

// Страница транскрипта завершённой сессии.
// Загружает сообщения через GET /api/sessions/[id]/transcript и выводит
// их в хронологическом порядке: реплики менеджера справа, клиента — слева.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Button from "@/app/components/Button";

interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

// Форматирует ISO-дату в строку времени HH:MM:SS
function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function TranscriptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Загружаем транскрипт при монтировании
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
          setError("Не удалось загрузить транскрипт");
          return;
        }
        const data = (await res.json()) as TranscriptMessage[];
        if (!cancelled) setMessages(data);
      } catch {
        if (!cancelled) setError("Не удалось загрузить транскрипт");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  // Выход из аккаунта
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Верхняя панель с кнопками */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Транскрипт разговора</h1>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => router.push("/session")}
            className="px-4 py-2 text-sm"
          >
            Новый разговор
          </Button>
          <Button
            variant="secondary"
            onClick={handleLogout}
            className="px-4 py-2 text-sm"
          >
            Выйти
          </Button>
        </div>
      </header>

      {/* Список сообщений */}
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        {loading && (
          <p className="text-center text-gray-500">Загрузка…</p>
        )}

        {error && <p className="text-center text-red-600">{error}</p>}

        {!loading && !error && messages.length === 0 && (
          <p className="text-center text-gray-500">В этой сессии пока нет сообщений.</p>
        )}

        {messages.map((msg, index) => {
          const isManager = msg.role === "user";
          return (
            <div
              key={index}
              className={`flex flex-col ${isManager ? "items-end" : "items-start"}`}
            >
              <span className="mb-1 text-xs text-gray-500">
                {isManager ? "Менеджер" : "Клиент"} · {formatTime(msg.createdAt)}
              </span>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isManager
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-800 shadow-sm"
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
