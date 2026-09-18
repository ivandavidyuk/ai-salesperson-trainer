// Недвижимость: офис продаж застройщика и случаи покупателей.
//
// Набор в работе (`inProgress` в clinic.ts): случаи добавляются по одному,
// первым — Тамара Михайловна (пилот этапа 2), потом «мама 30» и остальные
// по составу из docs/Каркас недвижимости.md.

import type { Preset } from "../types";
import { КЛИНИКА } from "./clinic";
import { СЛУЧАЙ as ТАМАРА } from "./tamara-sokolova";

export const ПРЕСЕТ: Preset = {
  clinic: КЛИНИКА,
  cases: [ТАМАРА],
};
