// Форматирование значений для интерфейса: длительности и даты разговоров.

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

// Секунды → «04:38». null → прочерк, чтобы таблица не «дырявилась»
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

// Дата разговора: «Сегодня, 11:24» · «Вчера, 16:02» · «12 июля, 09:47»
export function formatConversationDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

  const daysApart = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86_400_000
  );

  if (daysApart === 0) return `Сегодня, ${time}`;
  if (daysApart === 1) return `Вчера, ${time}`;

  const day = `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
  // Для прошлых лет добавляем год, иначе «12 июля» вводит в заблуждение
  const year = date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : "";
  return `${day}${year}, ${time}`;
}

// Срок задания: «до 22 июля» · «до завтра» · «сегодня» · «просрочено».
// Ближние сроки называем словами — так виднее, что горит.
export function formatDueDate(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);

  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

  const daysLeft = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  if (daysLeft < 0) return "просрочено";
  if (daysLeft === 0) return "сегодня";
  if (daysLeft === 1) return "до завтра";

  const day = `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
  const year = date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : "";
  return `до ${day}${year}`;
}

// Просрочено ли задание — срок раньше сегодняшнего дня
export function isOverdue(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return startOfDay(date) < startOfDay(now);
}

// Склонение существительного по числу: 1 задание, 2 задания, 5 заданий
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Инициалы для аватара: «Тамара Михайловна» → «ТМ»
export function initials(fullName: string | null): string {
  if (!fullName) return "—";
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

// Приветствие по локальному времени пользователя
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}
