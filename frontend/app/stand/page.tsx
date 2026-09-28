// Стенд сравнения моделей голоса: Тамара Михайловна на Flash или на
// ElevenLabs v4 Turbo. Разговор идёт через обычную страницу /session —
// та же проверка микрофона, тот же плеер, тот же разбор, — отличается только
// модель голоса. Иначе сравнение было бы нечестным.
//
// Страница видна только почтам из STAND_EMAILS (через запятую): своей
// админской роли в приложении нет, роли manager и head — клиентские.
// Остальным — 404, как будто страницы нет.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import StandForm from "./StandForm";

// Доступ проверяется на каждый запрос, кэшировать нечего
export const dynamic = "force-dynamic";

function стендОткрыт(email: string): boolean {
  const почты = (process.env.STAND_EMAILS ?? "")
    .split(",")
    .map((почта) => почта.trim().toLowerCase())
    .filter(Boolean);
  return почты.includes(email.trim().toLowerCase());
}

export default async function StandPage() {
  const user = await getAuthUser({ cookies: cookies() });
  if (!user || !стендОткрыт(user.email)) notFound();

  // Id у пациентов случайные: ищем по имени, как сиды (lib/demoScope.ts)
  const тамара = await prisma.patient.findFirst({
    where: { name: "Тамара Михайловна" },
    select: { id: true },
  });
  if (!тамара) notFound();

  return <StandForm patientId={тамара.id} />;
}
