// Проверка промптов пациентов. Запуск: npm run check:prompts
//
// Промпт — не код, его нельзя проверить типами, а ошибка в нём проявляется
// только в живом разговоре и не всегда сразу. Поэтому три вещи проверяются
// машинно:
//
// 1. Собранный промпт Тамары совпадает с тем, по которому она уже говорит
//    (эталон снят с прода). Ловит любое изменение текста — в том числе правку
//    самого слоя механизма, которую проверка №2 по построению увидеть не может:
//    она сверяет промпт с той же константой, что изменилась.
// 2. Слой механизма дошёл до каждой роли. Ловит другое: роль, до которой блок
//    не доехал — сборщик перестал его выдавать или пациента собрали в обход.
// 3. Два структурных инварианта: условие про оплату идёт первым номером,
//    блок запретов — последним.
//
// Проверки нарочно проверялись на отказ: без блока запретов первая и вторая
// падают вместе, при вставке чего-либо после запретов падает третья.

import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { LAYERED_ROLES, PATIENTS } from "./seed-patients";
import {
  MECHANIC_BLOCKS,
  buildRolePrompt,
  type PatientRole,
} from "./patient-prompt";

// Эталон Тамары: снят с прода 30.07.2026 запросом
//   SELECT length(prompt), md5(prompt) FROM "Patient" WHERE name = 'Тамара Михайловна';
//
// Сверяемся с хешем, а не с копией текста: копия в репозитории разошлась бы
// с базой незаметно, а хеш совпадает только с тем, что персонаж реально
// говорит. Намеренная правка промпта — значит обновить эти два числа тем же
// коммитом, и это видно в диффе.
const TAMARA_BASELINE = {
  length: 4451,
  md5: "ba3d2d9c0bd0171d71c2716d82ed18e2",
};

const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

// Пробный пациент: нужен, чтобы проверка «один раз написали — всем
// применилось» опиралась не на одну роль. Содержимое нарочно другое —
// от Тамары здесь не должно зависеть ничего.
const PROBE_ROLE: PatientRole = {
  identity: "Ты — пробный пациент, 40 лет.",
  manner: "- Отвечай коротко",
  situation: "Пришёл провериться.",
  calmWhile: "Пока говорят про осмотр — спокоен.",
  fears: ["Боится, что будет больно"],
  warmsUp: ["Если объясняют спокойно → теплеешь"],
  closesUp: ["Если торопят → замолкаешь"],
  mustHappen: ["Снят страх боли."],
  helps: "дал выговориться",
  decision: "Решаешь сам.",
};

const problems: string[] = [];
const fail = (text: string) => problems.push(text);

function checkMechanicLayer(label: string, prompt: string): void {
  // Сборщик обязан отдавать LF независимо от того, как лежит рабочая копия:
  // иначе сид с Windows записал бы в базу другой текст, чем сид в контейнере
  if (prompt.includes("\r")) {
    fail(`${label}: в собранном промпте остался CRLF — сборщик не нормализовал`);
  }

  MECHANIC_BLOCKS.forEach((block, index) => {
    if (!prompt.includes(block)) {
      const head = block.split("\n")[0];
      fail(`${label}: блок механизма №${index + 1} отсутствует или изменён — «${head}»`);
    }
  });

  // Условие про оплату занимает первый номер, свои условия пациента идут с 2
  if (!prompt.includes("1. Менеджер прямо предложил оплатить")) {
    fail(`${label}: условие про прямое предложение оплатить не первым номером`);
  }
  if (!/\n2\. /.test(prompt)) {
    fail(`${label}: нет условия под номером 2 — нумерация пациента сбита`);
  }

  // Запреты последними: вклиниться после них нельзя
  if (!prompt.endsWith(MECHANIC_BLOCKS[MECHANIC_BLOCKS.length - 1])) {
    fail(`${label}: блок запретов не в конце промпта`);
  }
}

function main(): void {
  console.log("=== Проверка промптов ===\n");

  // 1. Тамара совпадает с продом
  const tamara = buildRolePrompt(LAYERED_ROLES["Тамара Михайловна"]);
  const actual = { length: tamara.length, md5: md5(tamara) };
  const same =
    actual.length === TAMARA_BASELINE.length && actual.md5 === TAMARA_BASELINE.md5;

  console.log(`Тамара Михайловна: ${actual.length} символов, md5 ${actual.md5}`);
  if (same) {
    console.log("  совпадает с эталоном прода\n");
  } else {
    console.log(
      `  ЭТАЛОН: ${TAMARA_BASELINE.length} символов, md5 ${TAMARA_BASELINE.md5}\n`,
    );
    fail(
      "промпт Тамары разошёлся с эталоном. Если правка намеренная — обновите " +
        "TAMARA_BASELINE тем же коммитом; если нет, сборщик изменил текст",
    );
    // Во временную папку, а не в репозиторий: иначе каждый неудачный прогон
    // оставлял бы неотслеживаемый файл в рабочей копии. Сравнивать с прежним:
    //   git show origin/main:frontend/scripts/seed-patients.ts
    const dump = join(tmpdir(), "tamara-assembled.txt");
    writeFileSync(dump, tamara, "utf8");
    console.log(`  собранный промпт записан в ${dump}\n`);
  }

  // 2. Слой механизма — у всех переведённых на слои и у пробного
  for (const [name, role] of Object.entries(LAYERED_ROLES)) {
    checkMechanicLayer(name, buildRolePrompt(role));
  }
  checkMechanicLayer("пробный пациент", buildRolePrompt(PROBE_ROLE));

  const layered = Object.keys(LAYERED_ROLES).length;
  console.log(
    `Слой механизма: ${MECHANIC_BLOCKS.length} блоков проверено ` +
      `у ${layered + 1} ролей (${layered} настоящих + пробная)`,
  );

  // 3. Сколько ещё на заглушках — чтобы не забылось молча
  const stubs = PATIENTS.filter((p) => !(p.name in LAYERED_ROLES));
  console.log(`\nНа слоях: ${layered} из ${PATIENTS.length} пациентов`);
  if (stubs.length > 0) {
    console.log(`Заглушки: ${stubs.map((p) => p.name).join(", ")}`);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} проблем:`);
    for (const problem of problems) console.error(`  — ${problem}`);
    process.exit(1);
  }
  console.log("\nВсё сходится.");
}

main();
