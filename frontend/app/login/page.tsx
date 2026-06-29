"use client";

// Страница входа.
// Форма email + пароль → POST /api/auth/login.
// При успехе редирект на /session, при ошибке — сообщение.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/Button";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Обработка сабмита формы
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        // Успешный вход — переходим на главный экран
        router.push("/session");
        return;
      }

      // Любая ошибка авторизации — единое сообщение
      setError("Неверный email или пароль");
    } catch {
      setError("Не удалось связаться с сервером");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 shadow-sm"
      >
        <h1 className="text-center text-2xl font-semibold text-gray-900">
          Вход
        </h1>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-600">Пароль</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
              placeholder="••••••••"
            />
          </div>
        </div>

        {/* Сообщение об ошибке */}
        {error && (
          <p className="text-center text-sm text-red-600">{error}</p>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Вход…" : "Войти"}
        </Button>
      </form>
    </main>
  );
}
