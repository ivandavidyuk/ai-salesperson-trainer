// Тревоги о разговорах, которые не начались или зависли, — письмом.
//
// Зачем. 15.10 первый разговор первой клиники (Jamaica) упал на старте:
// сервер голоса взял мёртвое соединение с базой, менеджер остался на
// зависшем экране, а мы узнали об этом вечером, когда спросили «были ли
// разговоры». Сбой починен (#261), но следующий может быть другим — узнавать
// о нём надо в минуты, а не случайно.
//
// Что ищем (только чтение базы):
//   • сорвавшийся старт — сервер голоса закрыл сессию как несостоявшуюся
//     (`close_failed_start`): завершена, конец равен началу, реплик нет;
//     окно — два часа, чтобы новые сбои не тонули в старых;
//   • нет реплик дольше трёх минут, а сессия активна — старт, похоже,
//     сорвался, а закрыть её не вышло. Запись создаётся по «Начать»
//     прямо перед подключением голоса, так что три минуты тишины —
//     не ожидание у экрана проверки звука;
//   • активна дольше двух часов — полный разговор идёт до часа, это хвост.
//     Закрывать — с длительностью 0 (NOTES, «Проверка готовности перед
//     первым днём»), иначе счётчик часов спишет клиенту часы простоя.
//
// О каждой находке — одно письмо: метка в Redis на неделю. Не ушло
// письмо — метки снимаются, следующий запуск попробует снова.
//
// Запуск кроном на RU раз в пять минут:
//   docker exec ai-salesperson-trainer-frontend-1 npm run -s alerts:sessions
// Проба — письмо печатается, не отправляется и не помечается:
//   npm run alerts:sessions -- --проба

import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import { OPERATOR } from "../lib/legal";
import { отправитьПисьмо } from "../lib/mail";

const prisma = new PrismaClient();
const проба = process.argv.includes("--проба");
const НЕДЕЛЯ_СЕК = 7 * 24 * 3600;

type Вид = "сбой_старта" | "без_реплик" | "висит";

interface Находка {
  вид: Вид;
  id: string;
  начало: Date;
  клиника: string | null;
  почта: string;
  имя: string;
  пациент: string | null;
  упражнение: string | null;
  минут: number;
}

const ЗАГОЛОВОК: Record<Вид, string> = {
  сбой_старта: "Сорвался старт разговора",
  без_реплик: "Разговор открыт, а реплик нет",
  висит: "Сессия висит активной",
};

function пояснение(н: Находка): string {
  switch (н.вид) {
    case "сбой_старта":
      return (
        "Сервер голоса не смог начать разговор и закрыл сессию с длительностью 0. " +
        "Менеджер увидел «Не удалось начать разговор. Нажмите «Начать» ещё раз». " +
        `Причина — в логе сервера голоса (DE): строка «СБОЙ СТАРТА сессия ${н.id}».`
      );
    case "без_реплик":
      return (
        `Открыта ${н.минут} мин, ни одной реплики. Похоже, старт сорвался, а сессия ` +
        `не закрылась. Лог сервера голоса (DE) — по id ${н.id}.`
      );
    case "висит":
      return (
        `Активна ${Math.floor(н.минут / 60)} ч ${н.минут % 60} мин — это не разговор. ` +
        "Закрывать с длительностью 0 или по последней реплике, не штатно: " +
        "штатное закрытие спишет клиенту часы простоя (NOTES, «Проверка готовности»)."
      );
  }
}

/** «15.10 16:50» по Москве — так время читают в письме */
function мск(дата: Date): string {
  const d = new Date(дата.getTime() + 3 * 3600 * 1000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)} ${d.slice(11, 16)}`;
}

/** Тема и текст письма. Отдельно от отправки, чтобы проверять без почты */
export function письмоТревоги(находки: Находка[]): { тема: string; текст: string } {
  const клиники = Array.from(new Set(находки.map((н) => н.клиника ?? "без клиники")));
  const тема =
    находки.length === 1
      ? `Тренажёр: ${ЗАГОЛОВОК[находки[0].вид].toLowerCase()} — ${клиники[0]}`
      : `Тренажёр: ${находки.length} тревоги по разговорам — ${клиники.join(", ")}`;
  const блоки = находки.map((н) =>
    [
      `${ЗАГОЛОВОК[н.вид]} · ${мск(н.начало)} МСК`,
      `Клиника: ${н.клиника ?? "—"} · ${н.имя} (${н.почта})`,
      `Пациент: ${н.пациент ?? "—"} · ${н.упражнение ?? "—"}`,
      пояснение(н),
      `Сессия: ${н.id}`,
    ].join("\n"),
  );
  return { тема, текст: блоки.join("\n\n") };
}

async function найти(): Promise<Находка[]> {
  type Строка = Omit<Находка, "минут"> & { минут: number | bigint };
  const строки = await prisma.$queryRaw<Строка[]>`
    WITH кандидаты AS (
      SELECT s."id", s."startedAt", s."status", s."endedAt", s."durationSec",
             s."userId", s."patientId", s."trainingTypeId",
             EXISTS (SELECT 1 FROM "Message" m WHERE m."sessionId" = s."id") AS "есть_реплики"
      FROM "Session" s
      WHERE s."startedAt" > now() - interval '7 days'
    )
    SELECT
      CASE
        WHEN к."status" = 'completed' AND к."endedAt" = к."startedAt" AND к."durationSec" = 0
             AND NOT к."есть_реплики" AND к."startedAt" > now() - interval '2 hours'
          THEN 'сбой_старта'
        WHEN к."status" = 'active' AND к."startedAt" < now() - interval '2 hours'
          THEN 'висит'
        WHEN к."status" = 'active' AND NOT к."есть_реплики"
             AND к."startedAt" < now() - interval '3 minutes'
             AND к."startedAt" > now() - interval '24 hours'
          THEN 'без_реплик'
      END AS "вид",
      к."id", к."startedAt" AS "начало", o."name" AS "клиника", u."email" AS "почта",
      trim(u."firstName" || ' ' || coalesce(u."lastName", '')) AS "имя",
      p."name" AS "пациент", t."title" AS "упражнение",
      floor(extract(epoch FROM now() - к."startedAt") / 60)::int AS "минут"
    FROM кандидаты к
    JOIN "User" u ON u."id" = к."userId"
    LEFT JOIN "Organization" o ON o."id" = u."organizationId"
    LEFT JOIN "Patient" p ON p."id" = к."patientId"
    LEFT JOIN "TrainingType" t ON t."id" = к."trainingTypeId"
    ORDER BY к."startedAt"`;
  return строки
    .filter((с) => с.вид)
    .map((с) => ({ ...с, минут: Number(с.минут) }));
}

async function main(): Promise<void> {
  const находки = await найти();
  if (!находки.length) {
    if (проба) console.log("Тревог нет");
    return;
  }

  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const новые: Находка[] = [];
    const метки: string[] = [];
    for (const н of находки) {
      const ключ = `alert:session:${н.вид}:${н.id}`;
      if (проба) {
        if (!(await redis.exists(ключ))) новые.push(н);
        continue;
      }
      // NX: метку ставит только первый запуск — он и шлёт письмо
      if ((await redis.set(ключ, "1", { NX: true, EX: НЕДЕЛЯ_СЕК })) === "OK") {
        новые.push(н);
        метки.push(ключ);
      }
    }
    if (!новые.length) return;

    const { тема, текст } = письмоТревоги(новые);
    if (проба) {
      console.log(`[проба] письмо не отправлено\nТема: ${тема}\n\n${текст}`);
      return;
    }
    const ушло = await отправитьПисьмо({
      кому: process.env.ALERTS_EMAIL_TO || process.env.LEADS_EMAIL_TO || OPERATOR.email,
      тема,
      текст,
      что: "тревоги",
    });
    if (ушло) {
      console.log(`${new Date().toISOString()} тревог отправлено: ${новые.length} (${новые.map((н) => `${н.вид} ${н.id.slice(0, 8)}`).join(", ")})`);
    } else {
      // Письмо не ушло — снимаем метки, следующий запуск попробует снова
      await redis.del(метки);
      console.error(`${new Date().toISOString()} тревоги не отправлены: ${новые.length}, повтор через запуск`);
      process.exitCode = 1;
    }
  } finally {
    await redis.quit();
  }
}

// Только при запуске самого файла: импорт ради письмоТревоги базу не трогает
if (require.main === module) main()
  .catch((ошибка) => {
    console.error(`${new Date().toISOString()} сторож тревог упал:`, ошибка);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
