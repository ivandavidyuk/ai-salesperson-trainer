// Уведомление о заявке с лендинга в групповой чат «Заявки podhod».
//
// Бот один и чат один: в группе Иван, Дима и бот. Новых людей добавляют
// в группу, а не в код. Токен и номер чата — в frontend/.env
// (TELEGRAM_BOT_TOKEN, TELEGRAM_LEADS_CHAT_ID).
//
// Функция не бросает исключений: заявка к этому моменту уже в базе,
// и человеку, оставившему контакт, незачем знать, что Telegram не ответил.
// Вместо ошибки — ответ, дошло ли сообщение.

import type { LeadInput } from "@/lib/leads";

const TIMEOUT_MS = 5000;

// Ник Telegram: 5–32 знака из латиницы, цифр и подчёркивания
const USERNAME = /^@?([A-Za-z0-9_]{5,32})$/;

function messageFor(lead: LeadInput): string {
  const username = lead.telegram.match(USERNAME)?.[1];
  // Ссылка на профиль — чтобы написать человеку одним нажатием.
  // Номер телефона оставляем как есть: ссылки по номеру у Telegram нет
  const contact = username ? `@${username} — https://t.me/${username}` : lead.telegram;

  return [
    "Новая заявка с лендинга",
    "",
    `Имя: ${lead.name}`,
    `Telegram: ${contact}`,
    `Сфера: ${lead.industry}`,
    `Менеджеров в отделе: ${lead.teamSize}`,
  ].join("\n");
}

export async function notifyLead(lead: LeadInput): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_LEADS_CHAT_ID;
  if (!token || !chatId) {
    console.error(
      "Заявка не отправлена в Telegram: не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_LEADS_CHAT_ID",
    );
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageFor(lead),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        "Telegram не принял заявку:",
        res.status,
        await res.text().catch(() => ""),
      );
      return false;
    }
    return true;
  } catch (err) {
    // Сам адрес с токеном в лог не пишем — только причину
    console.error(
      "Telegram не ответил на заявку:",
      err instanceof Error ? err.name : "неизвестная ошибка",
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
