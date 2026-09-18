// Корневой layout приложения.
// Подключает шрифты дизайн-системы podhod.tech через next/font (шрифты
// self-hosted: без обращений к Google в рантайме и без сдвига макета).

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans, Manrope } from "next/font/google";
import AchievementToasts from "@/app/components/AchievementToasts";
import IndustryProvider from "@/app/components/IndustryProvider";
import { ОТРАСЛЬ_COOKIE, ключИзСлага } from "@/lib/industryWords";
import "./globals.css";

// Основной шрифт интерфейса
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Моноширинный: таймер, мета-подписи
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["500"],
  variable: "--font-mono",
  display: "swap",
});

// Только для логотипа podhod.tech
const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "podhod.tech — ИИ-тренажёр по продажам",
  description: "Голосовой тренажёр для менеджеров по продажам",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Отрасль организации из cookie: страница с первой отрисовки говорит
  // словами своей отрасли — «Клиенты» у офиса продаж, «Пациенты» у клиники.
  // Без cookie (до входа, вход до 18.09) — клиника, как было; дальше её
  // поставит /api/auth/me. Чтение cookie делает страницы динамическими —
  // они и так все за входом и собирают данные на лету
  const отрасль = ключИзСлага(cookies().get(ОТРАСЛЬ_COOKIE)?.value);
  return (
    <html
      lang="ru"
      className={`${plexSans.variable} ${plexMono.variable} ${manrope.variable}`}
    >
      <body>
        <IndustryProvider initial={отрасль}>
          {children}
          {/* Плашка о полученном бейдже — здесь, а не в AppShell: главный
              экран для неё, /transcript/[id], живёт вне оболочки. Молчание
              на входе и на звонке она обеспечивает сама */}
          <AchievementToasts />
        </IndustryProvider>
      </body>
    </html>
  );
}
