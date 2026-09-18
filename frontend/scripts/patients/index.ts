// Все пациенты тренажёра. Порядок здесь — порядок в мастере настройки.
//
// Дарья Олеговна (18.09) — первая, написанная нами с нуля по CHARACTERS.md.
// Двадцать из двадцати одного библиотечных написаны Димой (файл «Аватары 20 штук ФИНАЛ»),
// Тамара — наша, на ней отлаживался механизм сделки.

import { profile as tamara } from "./tamara-sokolova";
import { profile as darya } from "./darya-melnikova";
import { profile as pavel } from "./pavel-klimov";
import { profile as artem } from "./artem-kovalev";
import { profile as oleg } from "./oleg-shestakov";
import { profile as svetlana } from "./svetlana-belova";
import { profile as denis } from "./denis-vorontsov";
import { profile as kristina } from "./kristina-orlova";
import { profile as yulia } from "./yulia-tkachenko";
import { profile as vitaly } from "./vitaly-kuznetsov";
import { profile as rustam } from "./rustam-aliev";
import { profile as vanHao } from "./van-hao";
import { profile as nikolay } from "./nikolay-baranov";
import { profile as boris } from "./boris-kaplan";
import { profile as oksana } from "./oksana-kuznetsova";
import { profile as anzhelika } from "./anzhelika-kravtsova";
import { profile as igor } from "./igor-mitin";
import { profile as stanislav } from "./stanislav-shvets";
import { profile as gulsara } from "./gulsara-karimova";
import { profile as dzhamshid } from "./dzhamshid-akhmedov";
import { profile as leonid } from "./leonid-gromov";
import { profile as egor } from "./egor-borisov";
import { profile as mikhail } from "./mikhail-kravtsov";
import { profile as elena } from "./elena-voroshilova";
import { profile as galina } from "./galina-zaytseva";
import { profile as roman } from "./roman-savelyev";
import { profile as grigory } from "./grigory-logvinov";
import { profile as maria } from "./maria-slavnova";
import { industryKey } from "../patient-prompt";
import type { PatientProfile } from "./types";

export type { PatientProfile } from "./types";

export const PROFILES: PatientProfile[] = [
  tamara,
  // Написана под недвижимость (18.09); у клиник в состав не входит
  darya,
  pavel,
  artem,
  oleg,
  svetlana,
  denis,
  kristina,
  yulia,
  vitaly,
  rustam,
  vanHao,
  nikolay,
  boris,
  oksana,
  anzhelika,
  igor,
  stanislav,
  gulsara,
  dzhamshid,
  leonid,
  egor,
  mikhail,
  elena,
  galina,
  roman,
  grigory,
  maria,
];

/**
 * Состав отрасли — персонажи, которые в ней участвуют, в порядке мастера.
 *
 * Библиотека общая, но не всякий персонаж годится всякой отрасли, а новые
 * пишутся под одну. Состав — свойство репозитория, а не базы: от него
 * зависят список клиентов организации (api/patients), цели пересборки
 * у клиник (lib/cases) и полнота пресета (seed-presets, check-prompts).
 * Без него новый персонаж недвижимости появился бы в списках клиник,
 * и первая же пересборка собрала бы ему диагноз.
 */
/** Досье для руководителя словами отрасли организации: только перекрытые поля */
export function досьеОтрасли(
  name: string,
  industry: string
): Partial<Pick<PatientProfile, "character" | "decisionMaker" | "approach">> {
  const профиль = PROFILES.find((p) => p.name === name);
  return профиль?.досьеПоОтрасли?.[industryKey(industry)] ?? {};
}

export function составОтрасли(industry: string): PatientProfile[] {
  const ключ = industryKey(industry);
  return PROFILES.filter((p) => !p.industries || p.industries.includes(ключ));
}
