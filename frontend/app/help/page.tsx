// Справка «Как пользоваться»: шаги со снимками настоящих экранов
// и номерами-метками, подпись к метке — в несколько слов.
//
// Картинкой, а не текстом: первый заход 19.10 был абзацами, и Иван отверг
// его целиком — «сплошной текст, который никто никогда не будет читать».
// Снимки и места меток собирает scripts/help-shots.mjs (npm run help:shots,
// пишет shots.ts рядом): поменялся экран — перезапусти скрипт.
//
// Страница серверная: роль, отрасль и закрытая карточка известны сразу,
// и раздел руководителя не мигает, пока грузится профиль.

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/app/components/AppShell";
import HintTile, { Пиктограмма, пиктограммы } from "@/app/components/HintTile";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { медицинскаяОтрасль } from "@/lib/industry";
import { словаДляКлюча } from "@/lib/industryWords";
import { ключОтрасли } from "@/scripts/industry-key";
import HelpToc from "./HelpToc";
import { СНИМКИ, type Снимок } from "./shots";

// Роль и отрасль читаются на каждый запрос
export const dynamic = "force-dynamic";

const ПОЧТА = "podhod.tech-for-business@inbox.ru";

interface Раздел {
  id: string;
  /** Номер шага; у разделов руководителя номера нет */
  номер?: number;
  заголовок: string;
  снимки: Снимок[];
  /** Подписи к меткам — по порядку номеров на всех снимках раздела */
  подписи: string[];
  /** Ряд плиток под подписями (шаг «Говорите») */
  плитки?: { icon: ReactNode; label: string }[];
}

export default async function HelpPage() {
  const auth = await getAuthUser({ cookies: cookies() });
  if (!auth) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: {
      role: true,
      organization: { select: { industryKey: true, formLocked: true } },
    },
  });
  if (!user) redirect("/login");

  const отрасль = ключОтрасли(user.organization?.industryKey);
  const клиника = медицинскаяОтрасль(отрасль);
  const слова = словаДляКлюча(отрасль);
  const руководитель = user.role === "head";
  const снимки = клиника ? СНИМКИ.медицина : СНИМКИ.недвижимость;

  // Шаги менеджера. Диагностика — только у клиник: у офиса продаж кнопки
  // «Результат диагностики» нет, и номера шагов идут подряд без пропуска
  const шаги: Раздел[] = [
    {
      id: "s-type",
      заголовок: "Выберите тренировку",
      снимки: [снимки.type],
      подписи: ["Все этапы подряд", "Один навык за раз"],
    },
    {
      id: "s-patient",
      заголовок: `Выберите ${слова.клиента}`,
      снимки: [снимки.pat],
      подписи: ["Начните с лёгкого", `Имя открывает ${слова.заявку}`],
    },
    {
      id: "s-check",
      заголовок: "Проверьте звук",
      снимки: [снимки.check],
      подписи: ["Ваш микрофон", "Полоса за засечкой", "Начать разговор"],
    },
    {
      id: "s-talk",
      заголовок: "Говорите",
      снимки: [снимки.listen],
      подписи: ["Ваш ход", "Заканчиваете вы"],
      плитки: [
        { icon: пиктограммы.перебить, label: "Можно перебить" },
        { icon: пиктограммы.ожидание, label: "Дождитесь ответа" },
        { icon: пиктограммы.характер, label: "Характер, а не сбой" },
      ],
    },
    ...(клиника
      ? [
          {
            id: "s-doctor",
            заголовок: "Отправьте к врачу",
            снимки: [СНИМКИ.медицина.sheet],
            подписи: ["Нажмите, отправив к врачу", "Что предложить и цена", "Итог осмотра"],
          },
        ]
      : []),
    {
      id: "s-review",
      заголовок: "Смотрите разбор",
      снимки: [снимки.review],
      подписи: [
        "Согласился ли оплатить",
        "Среднее пяти этапов",
        "С чего начать работу",
        `Тот же ${слова.клиент} снова`,
      ],
    },
  ].map((шаг, i) => ({ ...шаг, номер: i + 1 }));

  const дляРуководителя: Раздел[] = [
    {
      id: "r-tasks",
      заголовок: "Ставьте задания",
      снимки: [снимки.tasks],
      подписи: [`Менеджер, ${слова.клиент} и тип`],
    },
    {
      id: "r-stats",
      заголовок: "Смотрите разговоры",
      снимки: [снимки.stat],
      подписи: ["Его разговоры и расшифровки"],
    },
    {
      id: "r-dossier",
      заголовок: `Досье ${слова.клиентов}`,
      снимки: [снимки.dossier],
      подписи: ["Видите только вы"],
    },
    {
      id: "r-profile",
      заголовок: слова.часыИУслуги,
      снимки: [снимки.hours, снимки.company],
      // Карточку закрытой клиники ведём мы: руководитель её не правит
      подписи: [
        "Считаются вместе с паузами",
        user.organization?.formLocked ? слова.услугиВедёмМы : слова.вашиУслуги,
      ],
    },
  ];

  const неТак = [
    { icon: пиктограммы.связь, title: "Связь прервалась", action: "Завершите и начните заново" },
    { icon: пиктограммы.микрофонМолчит, title: "Микрофон молчит", action: "Смените микрофон в плашке" },
    { icon: пиктограммы.плохоСлышно, title: "Вас плохо слышно", action: "Ближе к микрофону" },
    { icon: пиктограммы.собеседникМолчит, title: `${слова.Клиент} молчит`, action: "Завершите и начните заново" },
  ];

  const оглавление = [
    ...шаги.map((шаг) => ({ id: шаг.id, label: `${шаг.номер} · ${шаг.заголовок}` })),
    { id: "trouble", label: "Если что-то пошло не так" },
    ...(руководитель ? [{ id: "head", label: "Руководителю" }] : []),
  ];

  return (
    <AppShell title="Как пользоваться" phoneBack>
      {/* Оглавление — только с 1280 px: на планшете колонка 240 px
          вместе со снимком 312 px не оставляла места подписям, и страница
          уезжала вбок, а на 1024 подписи ломались в две строки. Уже 1280 —
          одна колонка, снимок рядом с подписями */}
      <div className="mx-auto w-full max-w-[1180px] px-12 pb-16 pt-9 xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start xl:gap-10 max-md:px-4 max-md:pb-7 max-md:pt-5">
        <HelpToc items={оглавление} />

        <div className="flex min-w-0 flex-col gap-4 max-md:gap-3">
          <h1 className="mb-1.5 text-[30px] font-semibold tracking-[-.015em] text-ink max-md:mb-1 max-md:text-[24px] max-md:font-bold max-md:tracking-[-.01em]">
            Как пользоваться
          </h1>

          {шаги.map((шаг) => (
            <Карточка key={шаг.id} раздел={шаг} />
          ))}

          <section
            id="trouble"
            className="flex scroll-mt-6 flex-col gap-5 rounded-[18px] border border-line bg-surface-card px-7 py-6 max-md:gap-4 max-md:px-4 max-md:pb-5 max-md:pt-[18px]"
          >
            <h2 className="text-[22px] font-semibold tracking-[-.01em] text-ink max-md:text-[20px]">
              Если что-то пошло не так
            </h2>
            <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
              {неТак.map((случай) => (
                <div
                  key={случай.title}
                  className="flex items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5 text-brand"
                >
                  <Пиктограмма>{случай.icon}</Пиктограмма>
                  <div className="min-w-0">
                    <div className="text-[16px] font-semibold text-ink">{случай.title}</div>
                    <div className="mt-[3px] flex items-baseline gap-1.5 text-[15px] text-ink-label">
                      <span className="text-brand">→</span>
                      <span>{случай.action}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5 text-brand">
                <Пиктограмма>{пиктограммы.письмо}</Пиктограмма>
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold text-ink">Другое</div>
                  <a
                    href={`mailto:${ПОЧТА}`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-brand underline underline-offset-[3px]"
                  >
                    → Напишите нам
                  </a>
                  <div className="text-[13px] text-ink-muted">Приложите ссылку на разговор</div>
                </div>
              </div>
            </div>
          </section>

          {руководитель && (
            <div id="head" className="flex scroll-mt-6 flex-col gap-3.5">
              <h2 className="mt-3 text-[24px] font-bold tracking-[-.01em] text-ink max-md:text-[22px]">
                Руководителю
              </h2>
              {дляРуководителя.map((раздел) => (
                <Карточка key={раздел.id} раздел={раздел} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Раздел: заголовок, снимки с метками и подписи к меткам */
function Карточка({ раздел }: { раздел: Раздел }) {
  // Номера меток сквозные по всем снимкам раздела
  let номер = 0;
  const снимки = раздел.снимки.map((снимок) => ({
    снимок,
    номера: снимок.marks.map(() => ++номер),
  }));

  return (
    <section
      id={раздел.id}
      className="flex scroll-mt-6 flex-col gap-5 rounded-[18px] border border-line bg-surface-card px-7 py-6 max-md:gap-4 max-md:px-4 max-md:pb-5 max-md:pt-[18px]"
    >
      <div className="flex items-center gap-3">
        {раздел.номер !== undefined && (
          <span className="whitespace-nowrap rounded-full bg-brand-soft px-2.5 py-1 font-mono text-[13px] font-medium uppercase tracking-[.08em] text-brand-hover">
            Шаг {раздел.номер}
          </span>
        )}
        <h2 className="text-[22px] font-semibold leading-[1.25] tracking-[-.01em] text-ink max-md:text-[20px]">
          {раздел.заголовок}
        </h2>
      </div>

      <div className="flex items-center gap-9 max-md:flex-col max-md:items-stretch max-md:gap-4">
        <div className="flex shrink-0 flex-col items-center gap-2.5">
          {снимки.map(({ снимок, номера }) => (
            <СнимокСМетками key={снимок.src} снимок={снимок} номера={номера} alt={раздел.заголовок} />
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-5 max-md:gap-4">
          <ol className="flex flex-col gap-3">
            {раздел.подписи.map((подпись, i) => (
              <li key={подпись} className="flex items-center gap-3">
                <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand font-mono text-[14px] font-semibold text-white">
                  {i + 1}
                </span>
                <span className="text-[16px] font-medium leading-[1.35] text-ink">{подпись}</span>
              </li>
            ))}
          </ol>
          {раздел.плитки && (
            // Плиток три, но колонка подписей на ноутбуке бывает узкой —
            // тогда они встают в два ряда или столбиком, а не налезают друг на друга
            <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
              {раздел.плитки.map((плитка) => (
                <HintTile key={плитка.label} icon={плитка.icon} label={плитка.label} roomy />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Снимок экрана и кружки с номерами поверх — места в процентах от кадра */
function СнимокСМетками({
  снимок,
  номера,
  alt,
}: {
  снимок: Снимок;
  номера: number[];
  alt: string;
}) {
  return (
    <div
      className="relative w-[312px] max-w-full max-md:w-[281px]"
      style={{ aspectRatio: `${снимок.w} / ${снимок.h}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={снимок.src}
        alt={alt}
        width={снимок.w}
        height={снимок.h}
        loading="lazy"
        className="block h-full w-full rounded-[14px] border border-line bg-surface shadow-[0_14px_30px_-22px_rgba(6,32,29,.35)]"
      />
      {снимок.marks.map(([x, y], i) => (
        <span
          key={номера[i]}
          style={{ left: `${x}%`, top: `${y}%` }}
          className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[length:2.5px] border-white bg-brand font-mono text-[14px] font-semibold text-white shadow-[0_4px_10px_rgba(6,32,29,.35)]"
          aria-hidden="true"
        >
          {номера[i]}
        </span>
      ))}
    </div>
  );
}
