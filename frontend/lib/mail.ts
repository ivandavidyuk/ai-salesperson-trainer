// Отправка служебного письма — заявки с лендинга, тревоги о разговорах.
//
// Письмо доставляет сам RU-сервер: находит почтовый сервер получателя
// по MX-записи и передаёт письмо ему напрямую, без ящика-отправителя.
// Подпись DKIM и SPF-запись домена подтверждают почтовику, что письмо
// настоящее, — обе записи лежат в DNS домена. Данные не покидают Россию:
// сервер в РФ, ящик получателя — у российского почтового сервиса.
//
// Функция не бросает: письмо — уведомление о том, что уже произошло
// и записано, и его сбой не должен ронять того, кто уведомляет.

import { promises as dns } from "dns";
import nodemailer from "nodemailer";

const TIMEOUT_MS = 8000;

// Почтовые серверы принимают письма друг от друга только на 25-м порту
const SMTP_PORT = 25;

interface MailConfig {
  from: string;
  domain: string;
  selector: string;
  privateKey: string;
  helo: string;
}

function mailConfig(): MailConfig | null {
  const { MAIL_FROM, DKIM_SELECTOR, DKIM_PRIVATE_KEY, MAIL_HELO } = process.env;
  const domain = MAIL_FROM?.split("@")[1];
  if (!MAIL_FROM || !domain || !DKIM_SELECTOR || !DKIM_PRIVATE_KEY) return null;
  return {
    from: MAIL_FROM,
    domain,
    selector: DKIM_SELECTOR,
    // В .env ключ лежит одной строкой в base64: переносы строк PEM
    // env_file Docker не переносит
    privateKey: Buffer.from(DKIM_PRIVATE_KEY, "base64").toString("utf8"),
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

/**
 * Отправляет письмо; true — его принял почтовый сервер получателя.
 * `что` — для лога: «о заявке», «тревоги», — чтобы по строке было видно,
 * какое письмо не ушло.
 */
export async function отправитьПисьмо(письмо: {
  кому: string;
  тема: string;
  текст: string;
  что: string;
}): Promise<boolean> {
  const config = mailConfig();
  if (!config) {
    console.error(`Письмо ${письмо.что} не отправлено: не заданы MAIL_FROM, DKIM_SELECTOR или DKIM_PRIVATE_KEY`);
    return false;
  }

  let hosts: string[];
  try {
    hosts = await mailServers(письмо.кому);
  } catch (err) {
    console.error(`Письмо ${письмо.что} не ушло: не найден почтовый сервер получателя —`, describe(err));
    return false;
  }

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
        to: письмо.кому,
        subject: письмо.тема,
        text: письмо.текст,
      });
      return true;
    } catch (err) {
      console.error(`Письмо ${письмо.что} не принял ${host}:`, describe(err));
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
