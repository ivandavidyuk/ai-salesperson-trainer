"use client";

// Что одна секция лендинга передаёт другой. Сейчас одно значение: средний
// чек из калькулятора читает секция окупаемости тарифа ниже.

import { createContext, useContext, useState, type ReactNode } from "react";

interface LandingState {
  check: number;
  setCheck: (value: number) => void;
}

const LandingContext = createContext<LandingState | null>(null);

/** Средний чек по умолчанию — пример из калькулятора */
export const DEFAULT_CHECK = 80000;

export function LandingStateProvider({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState(DEFAULT_CHECK);
  return (
    <LandingContext.Provider value={{ check, setCheck }}>{children}</LandingContext.Provider>
  );
}

export function useLandingState(): LandingState {
  const state = useContext(LandingContext);
  if (!state) throw new Error("useLandingState вне LandingStateProvider");
  return state;
}
