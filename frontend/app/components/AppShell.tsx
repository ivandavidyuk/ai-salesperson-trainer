"use client";

// Оболочка внутренних экранов: сворачиваемое боковое меню и топбар.
// Меню разворачивается поверх контента (как в макете), поэтому основная
// область не «прыгает» при переключении — под меню всегда зарезервирована
// узкая полоса шириной свёрнутого состояния.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import Logo from "@/app/components/Logo";

// Ширины меню из макета
const NAV_WIDTH_OPEN = 248;
const NAV_WIDTH_CLOSED = 66;

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Показывать ли счётчик активных заданий */
  badge?: boolean;
}

// Иконки — тонкие контурные, 21px, наследуют цвет пункта
const icons = {
  home: (
    <>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>
  ),
  tasks: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9z" />
      <path d="M8.5 12.5l2 2 4-4" />
    </>
  ),
  patients: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.4-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16 5.3A2.8 2.8 0 0119 8a2.8 2.8 0 01-1.2 2.3" />
      <path d="M20.5 20c0-2.4-1.2-4.2-3-5" />
    </>
  ),
  // Треугольник «play» — как на карточке полного разговора
  training: <path d="M8 5.5l11 6.5-11 6.5z" />,
  // Кубок, тот же что в сводке на странице достижений
  achievements: (
    <>
      <path d="M7 4h10v4a5 5 0 01-10 0z" />
      <path d="M7 6H4v1a3 3 0 003 3" />
      <path d="M17 6h3v1a3 3 0 01-3 3" />
      <path d="M9 20h6" />
      <path d="M12 13v7" />
    </>
  ),
  // В меню — человек в круге, в выпадающем меню профиля — без круга
  profile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.4 18.5a6 6 0 0111.2 0" />
    </>
  ),
  profileMenu: (
    <>
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5.5 20a6.5 6.5 0 0113 0" />
    </>
  ),
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Главная", icon: <Icon>{icons.home}</Icon> },
  { href: "/tasks", label: "Задания", icon: <Icon>{icons.tasks}</Icon>, badge: true },
  { href: "/patients", label: "Пациенты", icon: <Icon>{icons.patients}</Icon> },
  { href: "/training", label: "Тренировка", icon: <Icon>{icons.training}</Icon> },
  {
    href: "/achievements",
    label: "Достижения",
    icon: <Icon>{icons.achievements}</Icon>,
  },
  { href: "/profile", label: "Профиль", icon: <Icon>{icons.profile}</Icon> },
];

interface AppShellProps {
  /** Заголовок в топбаре */
  title: string;
  children: ReactNode;
}

export default function AppShell({ title, children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Меню по умолчанию свёрнуто: оно разворачивается поверх контента,
  // и открытое на старте перекрывало бы страницу при каждом заходе
  const [navOpen, setNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<{ firstName: string; lastName: string } | null>(
    null
  );

  // Число активных заданий для бейджа в меню
  const [taskCount, setTaskCount] = useState(0);

  // Имя для топбара берём из того же эндпоинта, что и остальные экраны
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUser(data);
      } catch {
        // молча: топбар не критичен для работы страницы
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Бейдж заданий: pathname в зависимостях — после запуска задания со
  // страницы «Задания» счётчик должен обновиться
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assignments/count");
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) setTaskCount(data.count);
      } catch {
        // молча: без бейджа меню остаётся рабочим
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  // «Ирина П.» — имя и первая буква фамилии
  const shortName = user
    ? `${user.firstName}${user.lastName ? ` ${user.lastName[0]}.` : ""}`
    : "";

  return (
    // h-screen (а не min-h-screen): нижний ряд главной должен растягиваться
    // на всю оставшуюся высоту, а список внутри — скроллиться
    <div className="relative flex h-screen">
      {/* Полоса под меню: не даёт контенту сдвигаться при разворачивании */}
      <div style={{ width: NAV_WIDTH_CLOSED }} className="shrink-0" />

      {/* Затемнение контента при развёрнутом меню; клик — сворачивает.
          Начинается после рейки, чтобы само меню не затемнялось. */}
      {navOpen && (
        <div
          style={{ left: NAV_WIDTH_CLOSED }}
          className="fixed inset-y-0 right-0 z-10 bg-[rgba(12,26,24,.42)]"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <nav
        style={{
          width: navOpen ? NAV_WIDTH_OPEN : NAV_WIDTH_CLOSED,
          boxShadow: navOpen ? "14px 0 40px -12px rgba(20,40,38,.75)" : "none",
        }}
        className="fixed inset-y-0 left-0 z-20 flex flex-col gap-1 overflow-hidden border-r border-line bg-surface-card px-2.5 py-3.5 transition-[width] duration-[260ms] ease-out"
      >
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          title="Меню"
          aria-label={navOpen ? "Свернуть меню" : "Развернуть меню"}
          className={`mb-2 flex items-center gap-3 px-[11px] py-[9px] ${
            navOpen ? "justify-start" : "justify-center"
          }`}
        >
          <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center text-brand-deep">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6.5h16" />
              <path d="M4 12h11" />
              <path d="M4 17.5h16" />
            </svg>
          </span>
          {navOpen && <Logo size="sm" className="whitespace-nowrap" />}
        </button>

        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const badge = item.badge && taskCount > 0 ? taskCount : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex w-full items-center gap-3 rounded-input px-[11px] py-2.5 text-sm transition-colors ${
                navOpen ? "justify-start" : "justify-center"
              } ${
                active
                  ? "bg-brand-soft font-semibold text-brand-hover"
                  : "font-medium text-ink-muted hover:bg-surface-bubble"
              }`}
            >
              <span className="relative inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                {item.icon}
                {/* В свёрнутом меню счётчик висит на иконке, в развёрнутом
                    уходит вправо — места для подписи там уже хватает */}
                {badge !== null && !navOpen && (
                  <span className="absolute -right-[5px] -top-1 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[length:1.5px] border-surface-card bg-brand px-[3px] text-[9px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </span>
              {navOpen && <span className="whitespace-nowrap">{item.label}</span>}
              {badge !== null && navOpen && (
                <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-surface-card px-7">
          <div className="text-[15px] font-semibold text-ink">{title}</div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((open) => !open)}
              className="flex items-center gap-2.5 rounded-input py-[5px] pl-1.5 pr-2.5 transition-colors hover:bg-surface-bubble"
            >
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
                {user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}` : ""}
              </span>
              <span className="text-sm text-ink-muted">{shortName || "…"}</span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-ink-icon"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {userMenuOpen && (
              <>
                {/* Клик мимо закрывает меню */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setUserMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-full z-50 w-[196px] pt-2">
                  <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface-card p-1.5 shadow-[0_18px_40px_-18px_rgba(20,40,38,.5)]">
                    <Link
                      href="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-2.5 text-sm font-medium text-ink-body transition-colors hover:bg-surface-bubble"
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-ink-muted"
                        aria-hidden="true"
                      >
                        {icons.profileMenu}
                      </svg>
                      Мой профиль
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-[11px] rounded-[9px] px-[11px] py-2.5 text-left text-sm font-medium text-danger-strong transition-colors hover:bg-danger-wash"
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M15 4h3a1 1 0 011 1v14a1 1 0 01-1 1h-3" />
                        <path d="M10 8l-4 4 4 4" />
                        <path d="M6 12h11" />
                      </svg>
                      Выйти
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* min-h-0 обязателен: без него flex-1 у нижнего ряда не сможет
            сжаться и список разговоров вылезет за экран вместо скролла */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
