// podhod.tech/start — лендинг для ссылок в соцсетях и визитка Димы.
// Единственная цель страницы — заявка на демо-доступ. Страница публичная
// (PUBLIC_PATHS в middleware.ts); корень podhod.tech по-прежнему ведёт на вход.

import type { Metadata } from "next";
import Landing from "./_landing/Landing";

const TITLE = "podhod.tech — голосовой тренажёр отдела продаж";
const DESCRIPTION =
  "Менеджеры учатся продавать на ИИ-клиентах, а не на ваших настоящих. Бесплатный демо-доступ.";

export const metadata: Metadata = {
  metadataBase: new URL("https://podhod.tech"),
  title: TITLE,
  description: DESCRIPTION,
  // Превью ссылки в Telegram и соцсетях
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/start",
    siteName: "podhod.tech",
    locale: "ru_RU",
    type: "website",
    images: [
      {
        url: "/landing/photo-manager-laptop.jpg",
        width: 1600,
        height: 1073,
        alt: "Менеджер в наушниках говорит с ИИ-клиентом",
      },
    ],
  },
};

export default function StartPage() {
  return <Landing />;
}
