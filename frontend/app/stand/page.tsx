// Стенд сравнения моделей голоса: любой пациент клиники на Flash или на
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

  const пользователь = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { organizationId: true },
  });
  if (!пользователь?.organizationId) notFound();

  // Те же условия, что проверяет sessions/start: пациент активен и у клиники
  // есть его случай с промптом. Порядок — как в сиде, первой идёт Тамара
  const случаи = await prisma.patientCase.findMany({
    where: {
      organizationId: пользователь.organizationId,
      prompt: { not: "" },
      patient: { isActive: true },
    },
    select: { patient: { select: { id: true, name: true } } },
    orderBy: { patient: { createdAt: "asc" } },
  });
  if (случаи.length === 0) notFound();

  return <StandForm patients={случаи.map((случай) => случай.patient)} />;
}
