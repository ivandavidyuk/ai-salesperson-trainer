"use client";

// Страница входа.
// Форма email + пароль → POST /api/auth/login.
// При успехе редирект на /session, при ошибке — сообщение.
//
// Оформление — макет «Вход» дизайн-системы podhod.tech (направление 1A):
// слева брендовая панель, справа форма. Состояния: пустое / ошибка / загрузка.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Alert from "@/app/components/Alert";
import Button from "@/app/components/Button";
import Field from "@/app/components/Field";
import Logo from "@/app/components/Logo";

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
        // Успешный вход — переходим на главную
        router.push("/");
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
    // Full-bleed split: панель и форма делят экран целиком, без «плавающей»
    // карточки — так макет одинаково держится и на 1440, и на широком мониторе.
    <main className="flex min-h-screen">
      {/* Брендовая панель. На узких экранах скрыта — мобильный макет
          будет сделан отдельно, сейчас форма просто занимает всю ширину. */}
      <aside className="hidden w-[46%] flex-col justify-between bg-brand px-20 py-[72px] text-white md:flex">
        <Logo tone="on-brand" size="lg" />

        {/* Ограничиваем длину строк, чтобы текст не растягивался на всю панель */}
        <div>
          <p className="max-w-[620px] text-[46px] font-semibold leading-[1.18] tracking-[-0.01em]">
            Тренируйте живой разговор с клиентом до звонка настоящему.
          </p>
          <p className="mt-6 max-w-[540px] text-lg leading-relaxed text-brand-panel-text">
            Голосовой ИИ-тренажёр для менеджеров клиники. Контакт, потребность,
            работа с возражениями — в безопасной репетиции.
          </p>
        </div>

        <p className="font-mono text-[13px] tracking-[0.04em] text-brand-panel-meta">
          Инструмент обучения · внутренний доступ
        </p>
      </aside>

      {/* Форма входа: центрируется в оставшейся части экрана */}
      <div className="flex flex-1 items-center justify-center bg-surface-card p-6 md:p-[60px]">
        <form onSubmit={handleSubmit} className="w-full max-w-[420px]">
          {/* Пока панель скрыта на узких экранах — показываем логотип здесь */}
          <Logo className="mb-8 md:hidden" />

          <h1 className="text-[32px] font-semibold tracking-[-0.01em] text-ink">
            Вход в аккаунт
          </h1>
          <p className="mt-2 text-base text-ink-muted">
            Войдите рабочей почтой клиники.
          </p>

          {/* Сообщение об ошибке */}
          {error && <Alert className="mt-6">{error}</Alert>}

          <Field
            label="Email"
            type="email"
            size="lg"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="manager@clinic.ru"
            disabled={loading}
            className="mt-8"
          />

          <Field
            label="Пароль"
            type="password"
            size="lg"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            invalid={Boolean(error)}
            aria-invalid={Boolean(error)}
            className="mt-5"
          />

          {/* Восстановления пароля пока нет — ссылка-заглушка, как в макете */}
          <div className="mt-2.5 flex justify-end">
            {loading ? (
              <span className="text-[13.5px] text-ink-placeholder">
                Забыли пароль?
              </span>
            ) : (
              <a
                href="#"
                className="text-[13.5px] text-brand hover:text-brand-hover"
              >
                Забыли пароль?
              </a>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            loading={loading}
            className="mt-[26px] w-full"
          >
            {loading ? "Входим…" : "Войти"}
          </Button>
        </form>
      </div>
    </main>
  );
}
