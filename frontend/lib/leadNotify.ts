// Уведомление о заявке с лендинга — письмом на рабочую почту оператора.
//
// Письмо доставляет сам RU-сервер: находит почтовый сервер получателя
// по MX-записи и передаёт письмо ему напрямую, без ящика-отправителя.
// Подпись DKIM и SPF-запись домена подтверждают почтовику, что письмо
// настоящее, — обе записи лежат в DNS домена. Заявка не покидает Россию:
// сервер в РФ, ящик получателя — у российского почтового сервиса.
//
// Функция не бросает: заявка к этому моменту уже в базе, и человеку,
// оставившему контакт, незачем знать, что письмо не ушло.

import { promises as dns } from "dns";
import nodemailer from "nodemailer";
import { OPERATOR } from "./legal";
import type { LeadInput } from "./leads";

const TIMEOUT_MS = 8000;

// Почтовые серверы принимают письма друг от друга только на 25-м порту
const SMTP_PORT = 25;

// Ник в Telegram: 5–32 знака из латиницы, цифр и подчёркивания
const NICK = /^@?([A-Za-z0-9_]{5,32})$/;

interface MailConfig {
  from: string;
  domain: string;
  selector: string;
  privateKey: string;
  to: string;
  helo: string;
}

function mailConfig(): MailConfig | null {
  const { MAIL_FROM, DKIM_SELECTOR, DKIM_PRIVATE_KEY, LEADS_EMAIL_TO, MAIL_HELO } = process.env;
  const domain = MAIL_FROM?.split("@")[1];
  if (!MAIL_FROM || !domain || !DKIM_SELECTOR || !DKIM_PRIVATE_KEY) return null;
  return {
    from: MAIL_FROM,
    domain,
    selector: DKIM_SELECTOR,
    // В .env ключ лежит одной строкой в base64: переносы строк PEM
    // env_file Docker не переносит
    privateKey: Buffer.from(DKIM_PRIVATE_KEY, "base64").toString("utf8"),
    to: LEADS_EMAIL_TO || OPERATOR.email,
    helo: MAIL_HELO || domain,
  };
}

/** Почтовые серверы домена получателя, от главного к запасным */
async function mailServers(address: string): Promise<string[]> {
  const records = await dns.resolveMx(address.split("@")[1] ?? "");
  return records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange);
}

/** Что сказал почтовик — без текста письма; в лог идёт только это */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return "неизвестная ошибка";
  const { code, responseCode, response } = err as Error & {
    code?: string;
    responseCode?: number;
    response?: string;
  };
  return [code, responseCode, response?.slice(0, 160)].filter(Boolean).join(" ") || err.name;
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
    console.error("Письмо о заявке не отправлено: не заданы MAIL_FROM, DKIM_SELECTOR или DKIM_PRIVATE_KEY");
    return false;
  }

  let hosts: string[];
  try {
    hosts = await mailServers(config.to);
  } catch (err) {
    console.error("Письмо о заявке не ушло: не найден почтовый сервер получателя —", describe(err));
    return false;
  }

  const { subject, text } = leadMail(lead);

  // У почтовика несколько серверов: не ответил главный — пробуем запасной
  for (const host of hosts) {
    const transport = nodemailer.createTransport({
      host,
      port: SMTP_PORT,
      // Шифрование поднимется через STARTTLS, если сервер его предлагает
      secure: false,
      name: config.helo,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      dkim: {
        domainName: config.domain,
        keySelector: config.selector,
        privateKey: config.privateKey,
      },
    });

    try {
      await transport.sendMail({
        from: `podhod.tech <${config.from}>`,
        to: config.to,
        subject,
        text,
      });
      return true;
    } catch (err) {
      console.error(`Письмо о заявке не принял ${host}:`, describe(err));
      // Код 5xx — отказ по существу, запасной сервер того же почтовика
      // ответит так же
      const responseCode = (err as { responseCode?: number }).responseCode ?? 0;
      if (responseCode >= 500) return false;
    } finally {
      transport.close();
    }
  }
  return false;
}
