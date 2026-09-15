// POST /api/leads — заявка на демо-доступ с лендинга podhod.tech/start.
//
// Роут публичный (PUBLIC_PATHS в middleware.ts): его зовёт гость без входа.
// Вместо авторизации три защиты: строгая проверка полей, скрытое
// поле-ловушка для ботов и потолок заявок с одного адреса.

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLead } from "@/lib/leads";
import { ensureRedisConnected, redis } from "@/lib/redis";
import { notifyLead } from "@/lib/telegram";

export const runtime = "nodejs";

// Человек отправляет заявку один раз, от силы исправляет опечатку.
// Пятая за час — уже не человек
const LIMIT_PER_HOUR = 5;
const WINDOW_SEC = 60 * 60;

// Сколько ждать Redis. Клиент при недоступном сервере не падает, а бесконечно
// переподключается, и без потолка ожидания заявка висела бы вместе с ним
const REDIS_WAIT_MS = 1500;

/**
 * Ключ адреса для потолка. IP приходит от Caddy в X-Forwarded-For;
 * храним только хеш и только на время окна — адрес нам не нужен.
 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const hash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return `lead:rate:${hash}`;
}

async function countAttempt(key: string): Promise<number> {
  await ensureRedisConnected();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SEC);
  }
  return count;
}

async function overLimit(key: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const count = await Promise.race([
      countAttempt(key),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis не ответил за ${REDIS_WAIT_MS} мс`)),
          REDIS_WAIT_MS,
        );
      }),
    ]);
    return count > LIMIT_PER_HOUR;
  } catch (err) {
    // Упавший Redis не должен терять заявки: без потолка лучше, чем без заявок
    console.error("Потолок заявок не проверен, Redis недоступен:", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseLead(body);

  if (parsed.kind === "trap") {
    return NextResponse.json({ ok: true });
  }
  if (parsed.kind === "invalid") {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (await overLimit(clientKey(request))) {
    return NextResponse.json(
      {
        error:
          "Слишком много заявок подряд. Попробуйте через час или напишите нам в Telegram",
      },
      { status: 429 },
    );
  }

  try {
    const lead = await prisma.lead.create({ data: parsed.lead });
    if (await notifyLead(parsed.lead)) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { notifiedAt: new Date() },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Заявка не сохранена:", err);
    return NextResponse.json(
      { error: "Не получилось отправить заявку. Попробуйте ещё раз" },
      { status: 500 },
    );
  }
}
