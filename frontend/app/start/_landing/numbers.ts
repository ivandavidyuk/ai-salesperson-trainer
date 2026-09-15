// Числа на лендинге: рубли с разделителями, миллионы, склонения.

/** Разделяет разряды неразрывным пробелом: 15000000 → «15 000 000» */
export function groupDigits(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function rubles(value: number): string {
  return `${groupDigits(value)} ₽`;
}

/** 13 500 000 → «13,5 млн ₽» */
export function millions(value: number): string {
  const rounded = Math.round(value / 1e5) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  return `${text} млн ₽`;
}

/** Только цифры из строки: «15 000 000 ₽» → 15000000 */
export function digitsOf(text: string): number {
  const digits = text.replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

const NUMBER_WORDS = [
  "ноль",
  "одна",
  "две",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
  "десять",
];

/** До десяти — словом, как в тексте, дальше цифрой */
export function numberWord(value: number): string {
  return value <= 10 ? NUMBER_WORDS[value] : String(value);
}
