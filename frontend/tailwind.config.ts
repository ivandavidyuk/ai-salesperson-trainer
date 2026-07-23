// Конфигурация Tailwind CSS.
// content — пути, где Tailwind ищет используемые классы.
//
// Дизайн-система podhod.tech, направление 1A «Спокойная клиника».
// Токены названы по РОЛИ (brand / ink / surface / line / danger), а не по цвету —
// чтобы экраны не завязывались на конкретные hex и тёмную тему можно было
// добавить позже, не переписывая разметку.
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Фирменный teal и его производные
        brand: {
          DEFAULT: "#0E7A6E",
          hover: "#0A5F55",
          soft: "#E1EFEC", // подложка аватара, кольцо фокуса
          muted: "#7FB8B0", // кнопка в состоянии загрузки
          "on-muted": "#EAF5F3", // текст на приглушённом фоне
          // Текст на тиловой панели. Осветлён относительно макета ради WCAG AA:
          // на фоне #0E7A6E даже чистый белый даёт лишь 5.21:1, поэтому
          // порог 4.5:1 достигается только этими светлыми мятными.
          "panel-text": "#E4F7F4", // подпись — 4.69:1
          "panel-meta": "#DFF5F1", // мета снизу — 4.59:1
          deep: "#0E3A3E", // вордмарк логотипа на светлом фоне
          bright: "#05867B", // плашка .tech на светлом фоне
          "on-dark": "#7FC9BD", // подпись на тёмной карточке «Мотивация»
          "text-on-dark": "#DCEEEA", // текст на тёмной карточке
          score: "#0A5F55", // цифра средней оценки
          "score-muted": "#7FA9A2", // «/ 10» рядом с оценкой
          "score-label": "#5C8079", // подпись выделенной карточки
        },
        // Текст
        ink: {
          DEFAULT: "#16211F",
          body: "#25302E", // текст внутри карточек
          muted: "#5C6B6A",
          label: "#3C4B49",
          subtle: "#8A9695", // приглушённый (disabled-лейблы, даты)
          placeholder: "#A9BAB7",
          icon: "#9CA8A6", // неактивные иконки-стрелки
        },
        // Поверхности
        surface: {
          DEFAULT: "#F6F8F9", // фон страницы
          card: "#FFFFFF",
          bubble: "#F1F5F4", // реплика клиента, ховер пунктов меню
          accent: "#E7F3F0", // выделенная карточка статистики
          dark: "#123A38", // карточка «Мотивация»
        },
        // Рамки
        line: {
          DEFAULT: "#E3E9E8",
          strong: "#CBD8D6", // рамка полей ввода
          soft: "#EEF2F1", // разделители строк, дорожка прогресса
          accent: "#CFE6E0", // рамка выделенной карточки статистики
        },
        // Ошибки и деструктивные действия
        danger: {
          DEFAULT: "#BC3A32",
          surface: "#F7E4E2",
          border: "#EBC4C0",
          text: "#8F2C25",
          strong: "#B23B2E", // «Выйти», падение показателя
          soft: "#FBE3E1", // подложка падения
          wash: "#FBF3F2", // ховер пункта «Выйти»
        },
        // Положительная динамика и высокие оценки
        good: {
          DEFAULT: "#0A7D4B",
          surface: "#E1F4EC",
        },
        // Средние оценки и «точка роста»
        warn: {
          DEFAULT: "#9A6B08",
          surface: "#FBEFD6",
        },
        // Идеальная оценка 10/10 — золотой бейдж
        gold: {
          text: "#5A3C00",
          from: "#F4D67E",
          to: "#E3B23C",
          // Медаль «золотого» достижения на странице достижений
          medal: "#B8860B",
          "medal-deep": "#9A6B08",
        },
        // Шуточные достижения за курьёзы в разговоре
        merry: {
          DEFAULT: "#9C4368",
          surface: "#F3E4EA",
        },
        // Закрытое достижение: приглушённая карточка с замком
        locked: {
          surface: "#F4F6F6",
          border: "#E9EDEC",
          medal: "#EAEDEC",
          icon: "#A9B4B2",
          text: "#A2ABA9",
        },
        // Звезда «в избранном»
        star: {
          on: "#E6A700",
          off: "#B7C2C0",
        },
        // Неактивные элементы
        disabled: {
          DEFAULT: "#B7C5C3",
          text: "#F6F8F9",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        brand: ["var(--font-brand)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        input: "10px", // поля ввода и кнопки
        "input-lg": "11px", // крупный масштаб (экран входа)
        card: "16px",
      },
      boxShadow: {
        card: "0 24px 60px -34px rgba(20, 40, 38, 0.4)",
      },
      keyframes: {
        // Пульсирующее кольцо вокруг аватара во время звонка
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.3)", opacity: "0" },
          "100%": { transform: "scale(1.3)", opacity: "0" },
        },
        // Расходящееся кольцо (индикатор «говорит клиент»)
        ringpulse: {
          "0%": { transform: "scale(0.55)", opacity: "0.55" },
          "100%": { transform: "scale(1.7)", opacity: "0" },
        },
        // Полоски эквалайзера (индикатор «слушаю вас»)
        barwave: {
          "0%, 100%": { transform: "scaleY(0.3)" },
          "50%": { transform: "scaleY(1)" },
        },
        // Мягкое дыхание элемента
        softpulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.05)", opacity: "1" },
        },
      },
      animation: {
        "pulse-ring":
          "pulse-ring 1.8s cubic-bezier(0.215, 0.61, 0.355, 1) infinite",
        ringpulse: "ringpulse 2.4s ease-out infinite",
        barwave: "barwave 1s ease-in-out infinite",
        softpulse: "softpulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
