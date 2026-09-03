"use client";

// Момент вручения бейджа: медаль выезжает справа снизу (макет «Получение
// достижения», вариант 2a).
//
// Очередь привязана к моменту выдачи, а не к экрану разбора. Так плашка
// работает и для бейджей без разговора — их на разборе не показать никогда,
// и разбор для них не повод. Отсюда же место монтирования: не AppShell,
// а корневой layout, потому что главный экран для плашек —
// /transcript/[id], и он живёт вне оболочки.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ACHIEVEMENTS_CHANGED_EVENT,
} from "@/app/components/AppShell";
import {
  Icon,
  TONE_CLASSES,
  iconFor,
  type Tone,
} from "@/app/components/achievementVisuals";

interface Бейдж {
  id: string;
  name: string;
  description: string;
  icon: string;
  tone: Tone;
}

// Из макета: пауза до первой плашки и шаг между соседними
const ПАУЗА_ДО_ПОКАЗА_МС = 500;
const ШАГ_ПОЯВЛЕНИЯ_МС = 120;

// Предел стопки. Четыре плашки со строкой кнопок — 258 px, шестая часть
// экрана; пятая ждёт очереди и встаёт на место закрытой
const ПРЕДЕЛ_СТОПКИ = 4;

// На разборе бейдж приходит через секунды после разбора — там спрашиваем
// часто. На остальных экранах ждать нечего: бейдж без разговора появится
// когда появится, и лишние запросы ради него ни к чему
const ШАГ_НА_РАЗБОРЕ_МС = 3000;
const ШАГ_ОБЫЧНЫЙ_МС = 20000;

// Где плашка молчит. На звонке — потому что всплывашка посреди живого
// разговора сбивает; на входе — потому что показывать некому
const МОЛЧИМ = ["/login", "/session"];

/**
 * Закрытые в этой вкладке. Между закрытием и тем, как ответит следующий
 * опрос, бейдж ещё числится непоказанным — без этого множества плашка
 * успевала бы вернуться на секунду. Живёт, пока жива вкладка, как
 * cachedTaskCount в AppShell.
 */
const закрытые = new Set<string>();

export default function AchievementToasts() {
  const pathname = usePathname();
  const молчим = МОЛЧИМ.some(
    (путь) => pathname === путь || pathname.startsWith(`${путь}/`)
  );

  const [очередь, setОчередь] = useState<Бейдж[]>([]);
  const наЭкране = очередь.slice(0, ПРЕДЕЛ_СТОПКИ);

  // Что уже в очереди — нужно опросу, чтобы отличить новый бейдж от того же
  // самого. Читать это внутри setОчередь нельзя: апдейтер обязан быть чистым
  const очередьRef = useRef<Бейдж[]>([]);
  очередьRef.current = очередь;

  // Свежий список для уборки при переходе: сама уборка живёт в cleanup,
  // а он видит только то, что было на момент подписки
  const наЭкранеRef = useRef<string[]>([]);
  наЭкранеRef.current = наЭкране.map((бейдж) => бейдж.id);

  // Вход — чужая территория: бейджи предыдущего пользователя не должны
  // глушить плашки следующего, слаги-то одни и те же
  useEffect(() => {
    if (pathname === "/login") закрытые.clear();
  }, [pathname]);

  // Опрос. Свой, независимый от опроса разбора на /transcript/[id]: тот
  // останавливается по первому непустому разбору, то есть ровно перед тем,
  // как прилетают бейджи
  useEffect(() => {
    if (молчим) return;

    let остановлен = false;
    let таймер: ReturnType<typeof setTimeout> | undefined;
    const шаг = pathname.startsWith("/transcript/")
      ? ШАГ_НА_РАЗБОРЕ_МС
      : ШАГ_ОБЫЧНЫЙ_МС;

    async function спросить() {
      if (остановлен) return;
      // В скрытой вкладке не спрашиваем, но таймер не гасим: проснётся сама
      // на следующем шаге, без отдельной подписки на видимость
      if (!document.hidden) {
        try {
          const res = await fetch("/api/achievements/pending");
          if (res.ok) {
            const data = (await res.json()) as { count: number; items: Бейдж[] };
            const пришло = data.items.filter(
              (бейдж) => !закрытые.has(бейдж.id)
            );
            if (!остановлен) {
              const было = очередьRef.current;
              const новых = пришло.filter(
                (бейдж) => !было.some((старый) => старый.id === бейдж.id)
              ).length;
              // Счётчик в меню живёт в AppShell со своей копией числа —
              // сообщаем ему, иначе он обновится только при переходе
              if (новых > 0) {
                window.dispatchEvent(new Event(ACHIEVEMENTS_CHANGED_EVENT));
              }
              setОчередь(() => слить(было, пришло));
            }
          }
        } catch {
          // молча: без плашки страница остаётся рабочей
        }
      }
      if (!остановлен) таймер = setTimeout(спросить, шаг);
    }

    void спросить();
    return () => {
      остановлен = true;
      if (таймер) clearTimeout(таймер);
    };
  }, [pathname, молчим]);

  // Переход помечает плашки показанными: решение «гаснет при переходе».
  // Cleanup срабатывает и на смене маршрута, и при закрытии вкладки
  useEffect(() => {
    return () => {
      const ids = наЭкранеRef.current;
      if (ids.length) {
        пометить(ids);
        setОчередь([]);
      }
    };
  }, [pathname]);

  function закрыть(ids: string[]) {
    пометить(ids);
    setОчередь((было) => было.filter((бейдж) => !ids.includes(бейдж.id)));
  }

  if (молчим || наЭкране.length === 0) return null;

  const одна = наЭкране.length === 1;

  return (
    // pointer-events-none на обёртке: невидимая колонка не должна
    // перехватывать клики по странице под собой
    <div className="pointer-events-none fixed bottom-6 right-6 z-30 flex w-[352px] flex-col items-stretch gap-2">
      {наЭкране.map((бейдж, индекс) => (
        <ToastCard
          key={бейдж.id}
          бейдж={бейдж}
          задержка={ПАУЗА_ДО_ПОКАЗА_МС + индекс * ШАГ_ПОЯВЛЕНИЯ_МС}
          одна={одна}
          наЗакрытие={() => закрыть([бейдж.id])}
        />
      ))}

      <div className="pointer-events-auto flex items-center justify-between gap-3 px-1">
        {/* «Скрыть все» — от двух: закрывать по одной четыре раза
            раздражало бы со второго разговора */}
        {наЭкране.length > 1 ? (
          <button
            type="button"
            onClick={() => закрыть(наЭкране.map((бейдж) => бейдж.id))}
            className="text-[14px] font-semibold text-ink-muted transition-colors hover:text-ink"
          >
            Скрыть все
          </button>
        ) : (
          <span />
        )}

        {/* Обязательна: что открылось и сколько осталось — видно только
            на полке, иначе человек узнаёт новость и не может ничего с ней
            сделать */}
        <Link
          href="/achievements"
          className="text-[14px] font-semibold text-brand transition-colors hover:text-brand-hover"
        >
          Все достижения →
        </Link>
      </div>
    </div>
  );
}

function ToastCard({
  бейдж,
  задержка,
  одна,
  наЗакрытие,
}: {
  бейдж: Бейдж;
  задержка: number;
  одна: boolean;
  наЗакрытие: () => void;
}) {
  const [видна, setВидна] = useState(false);
  // Задержку берём разовую, на монтирование: при закрытии соседки индексы
  // сдвигаются, и без ref плашка проигрывала бы выезд заново
  const задержкаRef = useRef(задержка);

  useEffect(() => {
    const таймер = setTimeout(() => setВидна(true), задержкаRef.current);
    return () => clearTimeout(таймер);
  }, []);

  const тон = TONE_CLASSES[бейдж.tone] ?? TONE_CLASSES.skill;

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-[14px] border border-line bg-surface-card p-3 shadow-[0_18px_40px_-18px_rgba(20,40,38,.5)] transition-[opacity,transform] duration-300 ${
        видна ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0"
      }`}
    >
      <div
        className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] ${тон.medal}`}
      >
        <Icon size={22}>{iconFor(бейдж.icon)}</Icon>
      </div>

      <div className="min-w-0 flex-1">
        {/* Статус один для всех: шуточный бейдж отличается только цветом
            медальона, но не словами */}
        <div className={`text-[12.5px] font-semibold ${тон.status}`}>
          Открыто достижение
        </div>
        <div className="truncate text-[15.5px] font-semibold leading-tight text-ink">
          {бейдж.name}
        </div>
        {/* Условие — только когда плашка одна: место есть, а знать, за что
            дали, важнее всего в первый раз. От двух строка уходит, иначе
            стопка растёт */}
        {одна && (
          <div className="mt-0.5 text-pretty text-[13.5px] leading-snug text-ink-muted">
            {бейдж.description}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={наЗакрытие}
        aria-label="Скрыть"
        className="-mr-0.5 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/** Добавляет новое, не трогая уже показанное: иначе плашки моргали бы. */
function слить(было: Бейдж[], пришло: Бейдж[]): Бейдж[] {
  const пришлоIds = new Set(пришло.map((бейдж) => бейдж.id));
  const осталось = было.filter((бейдж) => пришлоIds.has(бейдж.id));
  const естьIds = new Set(осталось.map((бейдж) => бейдж.id));
  const добавка = пришло.filter((бейдж) => !естьIds.has(бейдж.id));

  // Ничего не изменилось — возвращаем прежний массив, чтобы не перерисовывать
  if (добавка.length === 0 && осталось.length === было.length) return было;

  return [...осталось, ...добавка];
}

/** Гасит плашки на сервере. Счётчик в меню при этом не трогается. */
function пометить(ids: string[]) {
  ids.forEach((id) => закрытые.add(id));
  void fetch("/api/achievements/shown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  }).catch(() => {
    // молча: в худшем случае плашка вернётся на следующем заходе
  });
}
