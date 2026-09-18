// Недвижимость: офис продаж застройщика и случаи покупателей.
//
// Набор в работе (`inProgress` в clinic.ts): случаи добавляются по одному,
// первым — Тамара Михайловна (пилот этапа 2), потом «мама 30» и остальные
// по составу из docs/Каркас недвижимости.md.

import type { Preset } from "../types";
import { КЛИНИКА } from "./clinic";
import { СЛУЧАЙ as ТАМАРА } from "./tamara-sokolova";
import { СЛУЧАЙ as ДАРЬЯ } from "./darya-melnikova";
import { СЛУЧАЙ as ПАВЕЛ } from "./pavel-klimov";
import { СЛУЧАЙ as АРТЁМ } from "./artem-kovalev";
import { СЛУЧАЙ as ОЛЕГ } from "./oleg-shestakov";
import { СЛУЧАЙ as СВЕТЛАНА } from "./svetlana-belova";
import { СЛУЧАЙ as ДЕНИС } from "./denis-vorontsov";

export const ПРЕСЕТ: Preset = {
  clinic: КЛИНИКА,
  cases: [ТАМАРА, ДАРЬЯ, ПАВЕЛ, АРТЁМ, ОЛЕГ, СВЕТЛАНА, ДЕНИС],
};
