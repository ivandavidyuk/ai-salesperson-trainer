// Тарифы тренажёра — те же, что в продающей деке (pricing.js проекта
// Claude Design). Черновик сетки в docs/Price.md от 24.08 другой: на лендинг
// идут цифры, которые уже показывают клиентам.

export interface Tariff {
  name: string;
  /** Часов разговора в месяц */
  hours: number;
  /** Цена за месяц, ₽ */
  price: number;
}

export const TARIFFS: Tariff[] = [
  { name: "Старт", hours: 30, price: 50000 },
  { name: "Рост", hours: 40, price: 65000 },
  { name: "Отдел", hours: 60, price: 85000 },
];
