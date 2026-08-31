// Выгрузка пресетных случаев в JSON — на проверку критиком.
//
//   npm run --silent dump:presets > пресеты.json
//
// Флаг --silent обязателен: без него npm печатает в stdout свою шапку,
// и JSON перестаёт разбираться.
//
// Дальше файл скармливается backend/scripts/review_presets.py — тому самому
// `case_review.review`, который в бою перечитывает сгенерированные случаи.
// Пресеты написаны руками, то есть мимо генератора и мимо его критика;
// без этого шага они уехали бы в прод непрочитанными второй моделью вовсе.
//
// Отдаём ровно то, что критик читает в бою: кто человек (identity), что ему
// поставили (картина), какую услугу предлагаем и какой анамнез увидит
// менеджер. Остальное — характер, страхи, манера — к правдоподобию диагноза
// отношения не имеет, и в запрос критика не идёт.

import { PROFILES } from "./patients";
import { ПРЕСЕТЫ } from "./presets";

const ЛИЧНОСТИ = new Map(PROFILES.map((p) => [p.name, p.personality]));

const выгрузка = ПРЕСЕТЫ.flatMap((пресет) =>
  пресет.cases.map((случай) => {
    const личность = ЛИЧНОСТИ.get(случай.patientName);
    if (!личность) {
      throw new Error(`Нет личности для «${случай.patientName}»`);
    }
    return {
      industry: пресет.clinic.industry,
      patientName: случай.patientName,
      // Критику нужен только identity: возраст и образ жизни, из которых
      // он поймёт, заметил бы человек описанное
      personality: { identity: личность.identity },
      picture: случай.picture,
      service: случай.service,
      case: { anamnesis: случай.anamnesis },
      // Документ диагностики — для отдельного критика (review_diagnostics.py),
      // который читает пару «анамнез + документ». Пусто у случаев, где
      // документа ещё нет
      diagnostics: случай.diagnostics ?? null,
    };
  }),
);

process.stdout.write(JSON.stringify(выгрузка, null, 2));
