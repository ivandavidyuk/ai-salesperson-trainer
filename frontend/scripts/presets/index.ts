// Отраслевые пресеты: список отраслей, для которых случаи уже написаны.
//
// Отсюда их берут сид (`seed-presets.ts`), проверялка промптов и выгрузка
// на критика. Новая отрасль добавляется одной строкой — и сразу попадает
// во все три.

import type { PatientCase } from "../patient-prompt";
import type { Preset } from "./types";
import { ПРЕСЕТ as СТОМАТОЛОГИЯ } from "./stomatologiya";
import { ПРЕСЕТ as ОФТАЛЬМОЛОГИЯ } from "./oftalmologiya";

export const ПРЕСЕТЫ: Preset[] = [СТОМАТОЛОГИЯ, ОФТАЛЬМОЛОГИЯ];

/**
 * Пресетный случай пациента в отрасли — по нему пересборка и генератор
 * дополняют случаи организаций слотами, которых в них ещё нет
 * (ситуативные страхи, деньги с собой). Нет пресета или пациента — undefined.
 */
export function пресетныйСлучай(industry: string, patientName: string): PatientCase | undefined {
  const ключ = industry.toLowerCase().trim();
  const пресет = ПРЕСЕТЫ.find((п) => п.clinic.industry === ключ);
  return пресет?.cases.find((с) => с.patientName === patientName)?.case;
}
