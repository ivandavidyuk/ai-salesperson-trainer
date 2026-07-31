// Все пациенты тренажёра. Порядок здесь — порядок в мастере настройки.
//
// Двадцать из двадцати одного написаны Димой (файл «Аватары 20 штук ФИНАЛ»),
// Тамара — наша, на ней отлаживался механизм сделки.

import { profile as tamara } from "./tamara-sokolova";
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
import type { PatientProfile } from "./types";

export type { PatientProfile } from "./types";

export const PROFILES: PatientProfile[] = [
  tamara,
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
