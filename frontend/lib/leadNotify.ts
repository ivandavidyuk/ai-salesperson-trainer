// Уведомление о заявке с лендинга — письмом на рабочую почту оператора.
// Как письмо доходит и почему оно не покидает Россию — в lib/mail.ts.
//
// Функция не бросает: заявка к этому моменту уже в базе, и человеку,
// оставившему контакт, незачем знать, что письмо не ушло.

import { OPERATOR } from "./legal";
import type { LeadInput } from "./leads";
import { отправитьПисьмо } from "./mail";

// Ник в Telegram: 5–32 знака из латиницы, цифр и подчёркивания
const NICK = /^@?([A-Za-z0-9_]{5,32})$/;

/** Тема и текст письма. Отдельно от отправки, чтобы проверять без почты */
export function leadMail(lead: LeadInput): { subject: string; text: string } {
  const nick = NICK.exec(lead.telegram);
  // Ник превращаем в ссылку, по которой Дмитрий сразу откроет диалог;
  // номер телефона оставляем как есть
  const contact = nick ? `@${nick[1]} — https://t.me/${nick[1]}` : lead.telegram;
  // Переводы строк из полей формы в теме не нужны: это заголовок письма
  const oneLine = (value: string) => value.replace(/\s+/g, " ");

  return {
    subject: `Заявка с сайта: ${oneLine(lead.name)}, ${oneLine(lead.industry)}`,
    text: [
      "Новая заявка на демо-доступ с podhod.tech/start",
      "",
      `Имя: ${lead.name}`,
      `Контакт: ${contact}`,
      `Сфера: ${lead.industry}`,
      `Менеджеров в отделе: ${lead.teamSize}`,
    ].join("\n"),
  };
}

export async function notifyLead(lead: LeadInput): Promise<boolean> {
  const { subject, text } = leadMail(lead);
  return отправитьПисьмо({
    кому: process.env.LEADS_EMAIL_TO || OPERATOR.email,
    тема: subject,
    текст: text,
    что: "о заявке",
  });
}
