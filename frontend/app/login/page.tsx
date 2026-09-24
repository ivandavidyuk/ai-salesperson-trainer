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
import { useSetIndustry } from "@/app/components/IndustryProvider";
import { ключИзСлага } from "@/lib/industryWords";

export default function LoginPage() {
  const router = useRouter();
  const задатьОтрасль = useSetIndustry();

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
        // Отрасль известна сразу: главная откроется словами своей отрасли,
        // не дожидаясь, пока её узнает шапка. Переход клиентский, и layout
        // с cookie до следующей полной загрузки не перерисовывается
        const данные = (await res.json().catch(() => null)) as { industry?: string } | null;
        задатьОтрасль(ключИзСлага(данные?.industry));
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
    <main className="flex min-h-screen max-md:min-h-dvh">
      {/* Брендовая панель. На телефоне её место занимают логотип и короткий
          слоган над формой */}
      <aside className="hidden w-[46%] flex-col justify-between bg-brand px-20 py-[72px] text-white md:flex">
        <Logo tone="on-brand" size="lg" />

        {/* Ограничиваем длину строк, чтобы текст не растягивался на всю панель */}
        <div>
          <p className="max-w-[620px] text-[47px] font-semibold leading-[1.18] tracking-[-0.01em]">
            Тренируйте живой разговор с клиентом до звонка настоящему.
          </p>
          <p className="mt-6 max-w-[540px] text-lg leading-relaxed text-brand-panel-text">
            Голосовой ИИ-тренажёр для менеджеров клиники. Контакт, потребность,
            работа с возражениями — в безопасной репетиции.
          </p>
        </div>

        <p className="font-mono text-[14.5px] tracking-[0.04em] text-brand-panel-meta">
          Инструмент обучения · внутренний доступ
        </p>
      </aside>

      {/* Форма входа: центрируется в оставшейся части экрана. На телефоне
          идёт сверху вниз, а подпись «Инструмент обучения» прижата к низу */}
      <div className="flex flex-1 items-center justify-center bg-surface-card p-6 max-md:flex-col max-md:items-stretch max-md:justify-start max-md:px-5 max-md:pb-12 max-md:pt-7 md:p-[60px]">
        <form onSubmit={handleSubmit} className="group w-full max-w-[420px]">
          <Logo className="mb-8 md:hidden max-md:mb-9" />

          {/* Слоган прячется, пока открыта клавиатура: иначе поля и кнопка
              «Войти» уезжают под неё */}
          <div className="md:hidden group-focus-within:hidden">
            <p className="text-pretty text-[22px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
              Тренируйте живой разговор с&nbsp;клиентом до&nbsp;звонка
              настоящему.
            </p>
            <p className="mt-2.5 text-[15px] leading-normal text-ink-muted">
              Голосовой ИИ-тренажёр для менеджеров клиники.
            </p>
            <div className="my-9 h-px bg-line" aria-hidden="true" />
          </div>

          <h1 className="text-[33px] font-semibold tracking-[-0.01em] text-ink max-md:text-[24px]">
            Вход в аккаунт
          </h1>
          <p className="mt-2 text-base text-ink-muted max-md:mt-1.5 max-md:text-[15px]">
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
            className="mt-8 max-md:mt-[22px]"
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
            className="mt-5 max-md:mt-4"
          />

          {/* Восстановления пароля пока нет — ссылка-заглушка, как в макете */}
          <div className="mt-2.5 flex justify-end max-md:mt-0.5">
            {loading ? (
              <span className="text-[15px] text-ink-placeholder max-md:inline-flex max-md:min-h-11 max-md:items-center">
                Забыли пароль?
              </span>
            ) : (
              <a
                href="#"
                className="text-[15px] text-brand hover:text-brand-hover max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                Забыли пароль?
              </a>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            loading={loading}
            className="mt-[26px] w-full max-md:mt-1.5"
          >
            {loading ? "Входим…" : "Войти"}
          </Button>
        </form>

        <p className="mt-auto pt-10 font-mono text-[13px] tracking-[0.04em] text-ink-subtle md:hidden">
          Инструмент обучения · внутренний доступ
        </p>
      </div>
    </main>
  );
}
