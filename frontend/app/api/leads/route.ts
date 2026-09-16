// POST /api/leads — заявка на демо-доступ с лендинга podhod.tech/start.
//
// Роут публичный (PUBLIC_PATHS в middleware.ts): его зовёт гость без входа.
// Вместо авторизации три защиты: строгая проверка полей, скрытое
// поле-ловушка для ботов и потолок заявок с одного адреса.
//
// Всё, что касается заявки, остаётся на RU-сервере: база, потолок
// и отправка письма. Поэтому потолок не в Redis — тот стоит на DE.

import { createHmac, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLead } from "@/lib/leads";
import { notifyLead } from "@/lib/leadNotify";

export const runtime = "nodejs";

// Человек отправляет заявку один раз, от силы исправляет опечатку.
// Пятая за час — уже не человек
const LIMIT_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;

// Разовых посетителей больше этого числа — пора вычистить старых
const SWEEP_AT = 1000;

// Ключ хеша рождается при старте процесса и нигде не записан. Без него
// адрес по хешу не восстановить даже перебором всех IPv4
const HASH_KEY = randomBytes(32);

// Времена недавних заявок по хешу адреса. Живёт в памяти процесса:
// frontend — один контейнер, счётчик общий; после выкатки он обнуляется,
// и для потолка «пять в час» это не страшно
const attempts = new Map<string, number[]>();

/** Ключ адреса для потолка. IP приходит от Caddy в X-Forwarded-For */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", HASH_KEY).update(ip).digest("hex");
}

function overLimit(key: string, now = Date.now()): boolean {
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  // Хвост длиннее потолка не нужен: решение от него не меняется
  attempts.set(key, [...recent, now].slice(-(LIMIT_PER_HOUR + 1)));

  if (attempts.size > SWEEP_AT) {
    attempts.forEach((times, other) => {
      if (times.every((at) => now - at >= WINDOW_MS)) attempts.delete(other);
    });
  }

  return recent.length + 1 > LIMIT_PER_HOUR;
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

  if (overLimit(clientKey(request))) {
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
