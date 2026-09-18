"use client";

// Отрасль организации для клиентских экранов: слова интерфейса и то,
// что у отрасли есть, а чего нет (результат диагностики — только у клиник).
//
// Начальное значение приходит из корневого layout — он читает cookie
// с отраслью, поэтому страница с первой отрисовки говорит своими словами.
// Дальше отрасль уточняют вход (он знает её сразу) и AppShell по ответу
// /api/auth/me: так провайдер догоняет смену пользователя без перезагрузки.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  словаДляКлюча,
  type IndustryKey,
  type IndustryWords,
} from "@/lib/industryWords";

interface IndustryContext {
  ключ: IndustryKey;
  задать: (ключ: IndustryKey) => void;
}

const Контекст = createContext<IndustryContext>({
  ключ: "медицина",
  задать: () => {},
});

export default function IndustryProvider({
  initial,
  children,
}: {
  initial: IndustryKey;
  children: ReactNode;
}) {
  const [ключ, задать] = useState<IndustryKey>(initial);
  // Сервер перерисовал layout с другой cookie — следуем ему
  useEffect(() => задать(initial), [initial]);
  return <Контекст.Provider value={{ ключ, задать }}>{children}</Контекст.Provider>;
}

/** Ключ отрасли: «медицина» или «недвижимость» */
export function useIndustry(): IndustryKey {
  return useContext(Контекст).ключ;
}

/** Уточнить отрасль — после входа или ответа /api/auth/me */
export function useSetIndustry(): (ключ: IndustryKey) => void {
  return useContext(Контекст).задать;
}

/** Слова интерфейса текущей отрасли */
export function useWords(): IndustryWords {
  return словаДляКлюча(useContext(Контекст).ключ);
}
