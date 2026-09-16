// Уведомление о заявке с лендинга — письмом на рабочую почту оператора.
//
// Письмо уходит с RU-сервера через SMTP российского почтового сервиса,
// и ящик лежит там же: ни при сохранении, ни при уведомлении заявка
// не покидает Россию.
//
// Функция не бросает: заявка к этому моменту уже в базе, и человеку,
// оставившему контакт, незачем знать, что письмо не ушло.

import nodemailer from "nodemailer";
import { OPERATOR } from "./legal";
import type { LeadInput } from "./leads";

const TIMEOUT_MS = 8000;

// Ник в Telegram: 5–32 знака из латиницы, цифр и подчёркивания
const NICK = /^@?([A-Za-z0-9_]{5,32})$/;

interface MailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  to: string;
}

function mailConfig(): MailConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, LEADS_EMAIL_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    to: LEADS_EMAIL_TO || OPERATOR.email,
  };
}

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
  const config = mailConfig();
  if (!config) {
    console.error("Письмо о заявке не отправлено: не заданы SMTP_HOST, SMTP_USER или SMTP_PASSWORD");
    return false;
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 — сразу TLS; на остальных портах nodemailer поднимет STARTTLS сам
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  try {
    const { subject, text } = leadMail(lead);
    // Отправитель совпадает с ящиком, под которым входим: чужой адрес
    // в From почтовый сервис отвергнет
    await transport.sendMail({
      from: `podhod.tech <${config.user}>`,
      to: config.to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    // В тексте ошибки SMTP бывает ответ сервера с адресами — в лог только код
    const code = err instanceof Error && "code" in err ? String(err.code) : "неизвестная ошибка";
    console.error("Письмо о заявке не ушло:", code);
    return false;
  } finally {
    transport.close();
  }
}
