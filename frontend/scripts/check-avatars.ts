// Проверка портретов пациентов. Запуск: npm run check:avatars
//
// Портрет привязан к пациенту по имени, а не колонкой в базе (почему —
// в lib/patientAvatars.ts). У такой связи ровно одна слабость: она нигде
// не проверяется типами. Заведут пациента — и он молча останется с
// инициалами; переименуют — и портрет тихо отвалится у всех.
//
// Поэтому сверяются три списка: пациенты репозитория, ключи карты и файлы
// в public/patients. Любое расхождение — ненулевой код выхода.

import { existsSync, readdirSync } from "fs";
import { join } from "path";

import { PROFILES } from "./patients";
import { PATIENT_PORTRAITS } from "../lib/patientAvatars";

const КАТАЛОГ = join(__dirname, "..", "public", "portraits");

function main(): void {
  const problems: string[] = [];

  const имена = PROFILES.map((p) => p.name);
  const ключи = Object.keys(PATIENT_PORTRAITS);
  const файлы = existsSync(КАТАЛОГ)
    ? readdirSync(КАТАЛОГ).filter((f) => f.endsWith(".webp"))
    : [];

  // 1. У каждого пациента есть строка в карте
  for (const имя of имена) {
    if (!PATIENT_PORTRAITS[имя]) {
      problems.push(`нет портрета у пациента «${имя}»`);
    }
  }

  // 2. В карте нет строк без пациента: опечатка в имени выглядит именно так
  for (const ключ of ключи) {
    if (!имена.includes(ключ)) {
      problems.push(
        `в карте есть «${ключ}», а такого пациента в репозитории нет`,
      );
    }
  }

  // 3. Файл на месте — и наоборот, лишних файлов не лежит
  const нужные = new Set(ключи.map((k) => `${PATIENT_PORTRAITS[k]}.webp`));
  for (const файл of списком(нужные)) {
    if (!файлы.includes(файл)) {
      problems.push(`карта ссылается на public/portraits/${файл}, файла нет`);
    }
  }
  for (const файл of файлы) {
    if (!нужные.has(файл)) {
      problems.push(`public/portraits/${файл} — на него никто не ссылается`);
    }
  }

  console.log(
    `Пациентов: ${имена.length}, строк в карте: ${ключи.length}, ` +
      `файлов: ${файлы.length}`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} проблем:`);
    for (const problem of problems) console.error(`  — ${problem}`);
    process.exit(1);
  }
  console.log("Портреты на месте у всех.");
}

/** Set в массив — чтобы не включать downlevelIteration ради одного цикла */
function списком(набор: Set<string>): string[] {
  const out: string[] = [];
  набор.forEach((x) => out.push(x));
  return out;
}

main();
