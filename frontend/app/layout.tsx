// Корневой layout приложения.
// Подключает шрифты дизайн-системы podhod.tech через next/font (шрифты
// self-hosted: без обращений к Google в рантайме и без сдвига макета).

import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Manrope } from "next/font/google";
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
  return (
    <html
      lang="ru"
      className={`${plexSans.variable} ${plexMono.variable} ${manrope.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
