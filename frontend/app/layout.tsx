// Корневой layout приложения.
// На этом этапе минимальный — страницы интерфейса добавляются на этапе 2.

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ИИ-тренажёр по продажам",
  description: "Голосовой тренажёр для менеджеров по продажам",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
