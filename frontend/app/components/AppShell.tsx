"use client";

// Оболочка внутренних экранов: сворачиваемое боковое меню и топбар.
// Меню разворачивается поверх контента (как в макете), поэтому основная
// область не «прыгает» при переключении — под меню всегда зарезервирована
// узкая полоса шириной свёрнутого состояния.
//
// На телефоне (уже 768 px) рейки нет: разделы — в панели внизу, шапка
// короче. Какой вариант показать, решает CSS, а не JS: так страница
// не мигает десктопной раскладкой, пока скрипт не узнал ширину экрана.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import Logo from "@/app/components/Logo";
import BackLink from "@/app/components/BackLink";
import Sheet from "@/app/components/Sheet";
import { useSetIndustry, useWords } from "@/app/components/IndustryProvider";
import { ключИзСлага } from "@/lib/industryWords";

// Ширины меню из макета. Макеты перерисованы под рамку 1440×900 — размер
// реального ноутбука, поэтому рейка и шапка стали крупнее: по элементам
// удобнее попадать, интерфейс соразмерен экрану.
const NAV_WIDTH_OPEN = 280;
const NAV_WIDTH_CLOSED = 72;

/**
 * Профиль сохранён — топбару пора перечитать имя и фото.
 * Событие вместо общего состояния: обновиться нужно ровно одному
 * компоненту и ровно в двух местах, контекст ради этого избыточен.
 */
export const PROFILE_UPDATED_EVENT = "podhod:profile-updated";

/**
 * Список полученных бейджей изменился — счётчику в меню пора перечитать себя.
 * Шлют двое: опрос плашек (открылся новый бейдж) и страница «Достижения»
 * (человек их посмотрел, счётчик гаснет). Оболочка живёт не на всех экранах,
 * поэтому событие — подсказка, а не единственный канал: на своих страницах
 * счётчик и так перечитывается при каждом переходе.
 */
export const ACHIEVEMENTS_CHANGED_EVENT = "podhod:achievements-changed";

interface ShellUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUpdatedAt: string | null;
  /** Слаг отрасли организации: по нему экраны берут слова */
  industry?: string;
}

/**
 * Последние известные значения для топбара и меню.
 *
 * AppShell рендерится внутри каждой страницы, а не в общем layout, поэтому
 * при переходе он размонтируется и состояние обнуляется. Без кэша пункт
 * «Статистика» (он только у руководителя) исчезал на время запроса роли,
 * а счётчик заданий прыгал с нуля на настоящее число. Модульная переменная
 * живёт, пока жива вкладка, и переживает перемонтирование.
 */
let cachedUser: ShellUser | null = null;
let cachedTaskCount = 0;
let cachedAchievementCount = 0;

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Какой счётчик показывать у пункта */
  badge?: "tasks" | "achievements";
  /** Пункт виден только руководителю */
  headOnly?: boolean;
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
  stats: (
    <>
      <path d="M4 20h17" />
      <path d="M6 20V11" />
      <path d="M12 20V4" />
      <path d="M18 20v-6" />
    </>
  ),
  // «Ещё» в нижней панели руководителя на телефоне
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
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
  {
    href: "/stats",
    label: "Статистика",
    icon: <Icon>{icons.stats}</Icon>,
    headOnly: true,
  },
  { href: "/tasks", label: "Задания", icon: <Icon>{icons.tasks}</Icon>, badge: "tasks" },
  { href: "/patients", label: "Пациенты", icon: <Icon>{icons.patients}</Icon> },
  { href: "/training", label: "Тренировка", icon: <Icon>{icons.training}</Icon> },
  {
    href: "/achievements",
    label: "Достижения",
    icon: <Icon>{icons.achievements}</Icon>,
    badge: "achievements",
  },
  { href: "/profile", label: "Профиль", icon: <Icon>{icons.profile}</Icon> },
];

// Нижняя панель телефона держит пять ячеек. Профиль в неё не входит — он
// в меню аватара, как в макете. У руководителя разделов на один больше,
// поэтому последние два уходят в лист «Ещё»
const PHONE_HIDDEN = new Set(["/profile"]);
const PHONE_MORE = new Set(["/training", "/achievements"]);

interface AppShellProps {
  /** Заголовок в топбаре */
  title: string;
  children: ReactNode;
  /**
   * Телефон: стрелка назад перед заголовком вместо аватара — для страниц,
   * куда попадают из меню аватара, а не из нижней панели (профиль)
   */
  phoneBack?: boolean;
}

export default function AppShell({ title, children, phoneBack = false }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const слова = useWords();
  const задатьОтрасль = useSetIndustry();

  // Меню по умолчанию свёрнуто: оно разворачивается поверх контента,
  // и открытое на старте перекрывало бы страницу при каждом заходе
  const [navOpen, setNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Лист «Ещё» нижней панели руководителя на телефоне
  const [moreOpen, setMoreOpen] = useState(false);
  // Стартуем с кэша: при переходе между страницами меню не должно моргать
  const [user, setUser] = useState<ShellUser | null>(cachedUser);

  // Число активных заданий для бейджа в меню
  const [taskCount, setTaskCount] = useState(cachedTaskCount);

  // Число непросмотренных достижений для бейджа в меню
  const [achievementCount, setAchievementCount] = useState(
    cachedAchievementCount
  );

  // Имя и фото для топбара. Перечитываем при переходе между страницами
  // и по событию из профиля: без него шапка показывала бы старое фото
  // и имя до первого перехода.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const data = (await res.json()) as ShellUser;
        cachedUser = data;
        if (!cancelled) {
          setUser(data);
          // Отрасль из ответа точнее cookie: её могли поменять в профиле
          задатьОтрасль(ключИзСлага(data.industry));
        }
      } catch {
        // молча: топбар не критичен для работы страницы
      }
    }

    void load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, load);
    };
    // Сеттер отрасли стабилен (это setState провайдера) и перезапусков не даёт
  }, [pathname, задатьОтрасль]);

  // Бейдж заданий: pathname в зависимостях — после запуска задания со
  // страницы «Задания» счётчик должен обновиться
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assignments/count");
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        cachedTaskCount = data.count;
        if (!cancelled) setTaskCount(data.count);
      } catch {
        // молча: без бейджа меню остаётся рабочим
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Бейдж достижений. Кроме перехода слушаем событие: бейдж может открыться,
  // пока человек стоит на одной странице, — тогда его находит опрос плашек
  // и сообщает сюда. Обратный случай тот же: со страницы «Достижения»
  // приходит сигнал погасить счётчик.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/achievements/pending");
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        cachedAchievementCount = data.count;
        if (!cancelled) setAchievementCount(data.count);
      } catch {
        // молча: без бейджа меню остаётся рабочим
      }
    }

    void load();
    window.addEventListener(ACHIEVEMENTS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(ACHIEVEMENTS_CHANGED_EVENT, load);
    };
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // Иначе следующий вошедший увидит в шапке имя и роль предыдущего,
    // пока не ответит /api/auth/me
    cachedUser = null;
    cachedTaskCount = 0;
    cachedAchievementCount = 0;
    router.push("/login");
  }

  // «Ирина П.» — имя и первая буква фамилии
  const shortName = user
    ? `${user.firstName}${user.lastName ? ` ${user.lastName[0]}.` : ""}`
    : "";

  const пункты = NAV_ITEMS.filter(
    // Пока роль не загружена, пункт руководителя не показываем:
    // мелькнуть и исчезнуть хуже, чем появиться с задержкой
    (item) => !item.headOnly || user?.role === "head"
  ).map((пункт) =>
    // Подпись раздела клиентов — словом отрасли
    пункт.href === "/patients" ? { ...пункт, label: слова.Клиенты } : пункт
  );

  // null — счётчика нет вовсе: нулевой бейдж не рисуем
  function счётчик(item: NavItem): number | null {
    const счёт =
      item.badge === "tasks"
        ? taskCount
        : item.badge === "achievements"
          ? achievementCount
          : 0;
    return счёт > 0 ? счёт : null;
  }

  // Телефон: у менеджера пять разделов помещаются в панель целиком,
  // у руководителя два последних уходят в «Ещё»
  const наТелефоне = пункты.filter((item) => !PHONE_HIDDEN.has(item.href));
  const вЕщё =
    user?.role === "head"
      ? наТелефоне.filter((item) => PHONE_MORE.has(item.href))
      : [];
  const вПанели = наТелефоне.filter((item) => !вЕщё.includes(item));
  const ещёАктивно = вЕщё.some((item) => item.href === pathname);

  // Аватар: фото или инициалы — одинаково в шапке компьютера и телефона
  const аватар = user?.avatarUpdatedAt ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`}
      alt=""
      className="h-full w-full object-cover"
    />
  ) : (
    <>{user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}` : ""}</>
  );

  return (
    // h-screen (а не min-h-screen): нижний ряд главной должен растягиваться
    // на всю оставшуюся высоту, а список внутри — скроллиться. На телефоне
    // dvh: 100vh там считается без адресной строки, и нижняя панель уезжала
    // бы под неё
    <div className="relative flex h-screen max-md:h-dvh">
      {/* Полоса под меню: не даёт контенту сдвигаться при разворачивании */}
      <div style={{ width: NAV_WIDTH_CLOSED }} className="shrink-0 max-md:hidden" />

      {/* Затемнение контента при развёрнутом меню; клик — сворачивает.
          Начинается после рейки, чтобы само меню не затемнялось. */}
      {navOpen && (
        <div
          style={{ left: NAV_WIDTH_CLOSED }}
          className="fixed inset-y-0 right-0 z-10 bg-[rgba(12,26,24,.42)] max-md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <nav
        style={{
          width: navOpen ? NAV_WIDTH_OPEN : NAV_WIDTH_CLOSED,
          boxShadow: navOpen ? "14px 0 40px -12px rgba(20,40,38,.75)" : "none",
        }}
        // Свёрнутая рейка центрирует пункты фиксированной ширины,
        // развёрнутая растягивает их на всю ширину меню
        className={`fixed inset-y-0 left-0 z-20 flex flex-col gap-1 overflow-hidden border-r border-line bg-surface-card px-2.5 py-3.5 transition-[width] duration-[260ms] ease-out max-md:hidden ${
          navOpen ? "items-stretch" : "items-center"
        }`}
      >
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          title="Меню"
          aria-label={navOpen ? "Свернуть меню" : "Развернуть меню"}
          className={`mb-2.5 flex items-center gap-3 rounded-xl ${
            navOpen
              ? "w-full justify-start px-3 py-2.5"
              : "h-11 w-[50px] justify-center"
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

        {пункты.map((item) => {
          const active = pathname === item.href;
          const badge = счётчик(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              // Свёрнутый пункт — фиксированная подложка 50×44 по центру
              // рейки; развёрнутый тянется на всю ширину с полями
              className={`flex items-center gap-3 rounded-input text-sm transition-colors ${
                navOpen
                  ? "w-full justify-start px-3 py-2.5"
                  : "h-11 w-[50px] justify-center"
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
                  <span className="absolute -right-[5px] -top-1 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[length:1.5px] border-surface-card bg-brand px-[3px] text-[10.5px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </span>
              {navOpen && <span className="whitespace-nowrap">{item.label}</span>}
              {badge !== null && navOpen && (
                <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[12.5px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* На телефоне шапка ниже и без логотипа: только название раздела
            и аватар, как в макете — на главную ведёт нижняя панель */}
        <header className="flex h-[66px] shrink-0 items-center justify-between border-b border-line bg-surface-card px-7 max-md:h-14 max-md:gap-1 max-md:pl-5 max-md:pr-2.5">
          <div className="flex items-center gap-3.5 max-md:min-w-0 max-md:flex-1">
            {/* Логотип есть на каждом экране и всегда ведёт на главную */}
            <Link href="/" title="На главную" className="shrink-0 max-md:hidden">
              <Logo size="sm" />
            </Link>
            <span className="h-5 w-px bg-line max-md:hidden" aria-hidden="true" />
            {phoneBack && (
              <BackLink
                className="-ml-3.5 inline-flex h-11 w-11 shrink-0 items-center justify-center text-ink md:hidden"
                ariaLabel="Назад"
                label={
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                }
              />
            )}
            <div className="text-[16.5px] font-semibold text-ink max-md:truncate max-md:text-[18px] max-md:tracking-[-.01em]">
              {title}
            </div>
          </div>

          <div className="flex items-center gap-3 max-md:gap-1.5">
            {/* У руководителя те же разделы, но наполнение другое —
                плашка объясняет, почему страница выглядит иначе.
                Стоит рядом с именем: это признак смотрящего, а не страницы */}
            {user?.role === "head" && (
              <span className="rounded-full bg-brand-soft px-2.5 py-[3px] text-[12px] font-bold uppercase tracking-[.06em] text-brand-hover">
                Руководитель
              </span>
            )}

            <div className={`relative ${phoneBack ? "max-md:hidden" : ""}`}>
              {/* На телефоне от кнопки остаётся один аватар в круге 44 px:
                  имя в узкой шапке не помещается рядом с названием раздела */}
              <button
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                title="Меню профиля"
                className="flex items-center gap-2.5 rounded-input py-[5px] pl-1.5 pr-2.5 transition-colors hover:bg-surface-bubble max-md:h-11 max-md:w-11 max-md:justify-center max-md:rounded-full max-md:p-0 max-md:hover:bg-transparent"
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-[14.5px] font-semibold text-brand max-md:h-9 max-md:w-9">
                  {аватар}
                </span>
                <span className="text-sm text-ink-muted max-md:hidden">{shortName || "…"}</span>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-ink-icon max-md:hidden"
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
                  {/* На телефоне пункты выше и крупнее — под палец */}
                  <div className="absolute right-0 top-full z-50 w-[196px] pt-2 max-md:w-[220px] max-md:pt-1">
                    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface-card p-1.5 shadow-[0_18px_40px_-18px_rgba(20,40,38,.5)] max-md:rounded-[14px]">
                      <Link
                        href="/profile"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-2.5 text-sm font-medium text-ink-body transition-colors hover:bg-surface-bubble max-md:min-h-12 max-md:gap-3 max-md:rounded-[10px] max-md:px-3 max-md:py-0 max-md:text-[16px]"
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
                        className="flex w-full items-center gap-[11px] rounded-[9px] px-[11px] py-2.5 text-left text-sm font-medium text-danger-strong transition-colors hover:bg-danger-wash max-md:min-h-12 max-md:gap-3 max-md:rounded-[10px] max-md:px-3 max-md:py-0 max-md:text-[16px]"
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
          </div>
        </header>

        {/* min-h-0 обязателен: без него flex-1 у нижнего ряда не сможет
            сжаться и список разговоров вылезет за экран вместо скролла */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>

        {/* Телефон: вместо рейки — панель внизу. Она часть колонки, а не
            fixed: контент прокручивается над ней и никогда под неё не уходит */}
        <nav className="flex shrink-0 justify-evenly border-t border-line bg-surface-card px-1.5 py-1.5 md:hidden">
          {вПанели.map((item) => (
            <PhoneTab
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={pathname === item.href}
              badge={счётчик(item)}
            />
          ))}
          {вЕщё.length > 0 && (
            <PhoneTab
              label="Ещё"
              icon={<Icon>{icons.more}</Icon>}
              active={ещёАктивно}
              badge={null}
              onClick={() => setMoreOpen(true)}
            />
          )}
        </nav>
      </div>

      {moreOpen && (
        <Sheet title="Ещё" onClose={() => setMoreOpen(false)} className="md:hidden">
          <div className="flex flex-col gap-1">
            {вЕщё.map((item) => {
              const badge = счётчик(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-14 items-center gap-3.5 rounded-xl px-2 text-[17px] font-medium text-ink active:bg-surface-bubble"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-bubble text-ink-muted">
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {badge !== null && (
                    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-brand px-1.5 text-[13px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-ink-icon"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Ячейка нижней панели: иконка в «пилюле» и подпись под ней */
function PhoneTab({
  href,
  label,
  icon,
  active,
  badge,
  onClick,
}: {
  href?: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  badge: number | null;
  onClick?: () => void;
}) {
  const className = `flex min-h-[52px] min-w-[56px] flex-none flex-col items-center justify-center gap-[3px] px-0.5 ${
    active ? "text-brand-hover" : "text-ink-muted"
  }`;
  const inner = (
    <>
      <span
        className={`relative inline-flex h-[30px] w-[52px] items-center justify-center rounded-full ${
          active ? "bg-brand-soft" : ""
        }`}
      >
        {icon}
        {badge !== null && (
          <span className="absolute -top-[5px] right-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border-[length:1.5px] border-surface-card bg-brand px-[5px] text-[13px] font-bold leading-none text-white">
            {badge}
          </span>
        )}
      </span>
      <span
        className={`whitespace-nowrap text-[13px] leading-[1.1] tracking-[-.02em] ${
          active ? "font-semibold" : "font-medium"
        }`}
      >
        {label}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}
