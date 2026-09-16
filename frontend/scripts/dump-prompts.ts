// Выгрузка собранных промптов пресетов в файлы — для побайтного сравнения
// «до» и «после» правок слоёв. Запуск: npm run dump:prompts -- <папка>
//
// Слои механизма и личности общие на все отрасли, поэтому любая их правка
// меняет промпты всех клиник разом. Сравнение двух выгрузок показывает,
// что именно изменилось, — и что не изменилось ничего, когда правка
// не должна была задеть клиники.

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { buildRolePrompt } from "./patient-prompt";
import { PROFILES } from "./patients";
import { ПРЕСЕТЫ } from "./presets";

const папка = process.argv[2];
if (!папка) {
  console.error("Укажите папку: npm run dump:prompts -- <папка>");
  process.exit(1);
}

let записано = 0;
for (const пресет of ПРЕСЕТЫ) {
  const каталог = join(папка, пресет.clinic.industry);
  mkdirSync(каталог, { recursive: true });
  for (const случай of пресет.cases) {
    const профиль = PROFILES.find((p) => p.name === случай.patientName);
    if (!профиль) continue;
    const промпт = buildRolePrompt({ personality: профиль.personality, case: случай.case });
    writeFileSync(join(каталог, `${случай.patientName}.txt`), промпт, "utf8");
    записано += 1;
  }
}
console.log(`Записано промптов: ${записано} в ${папка}`);
