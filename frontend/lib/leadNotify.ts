// Уведомление о заявке с лендинга в группу «Заявки podhod».
//
// Отправляет в Telegram не фронтенд: RU-сервер не достаёт api.telegram.org
// по IPv4 (замер 15.09 — таймаут в пяти попытках из пяти), а у контейнера
// нет IPv6. Заявка сохраняется здесь, в базе на RU, а уведомление отдаётся
// backend на DE по /leads/notify — оттуда Telegram отвечает за 0,1 с. Путь
// тот же, что у сборки случаев: FASTAPI_WS_URL → Caddy → DE.
//
// Функция не бросает: заявка к этому моменту уже в базе, и человеку,
// оставившему контакт, незачем знать, что уведомление не ушло.

import { signServiceToken } from "@/lib/auth";
import { backendUrl } from "@/lib/cases";
import type { LeadInput } from "@/lib/leads";

const TIMEOUT_MS = 8000;

export async function notifyLead(lead: LeadInput): Promise<boolean> {
  try {
    const token = await signServiceToken("landing-leads");
    const res = await fetch(`${backendUrl()}/leads/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Уведомление о заявке не ушло: HTTP ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "Backend не ответил на уведомление о заявке:",
      err instanceof Error ? err.name : "неизвестная ошибка",
    );
    return false;
  }
}
