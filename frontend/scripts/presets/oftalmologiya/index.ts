// Случаи отрасли: по файлу на пациента, порядок как в списке пациентов.
//
// Собирается вручную, а не автозагрузкой каталога: явный список — это ещё
// и проверка полноты, пропущенного пациента видно в диффе.

import type { Preset } from "../types";
import { КЛИНИКА } from "./clinic";
import { СЛУЧАЙ as с0 } from "./gulsara-karimova";
import { СЛУЧАЙ as с1 } from "./elena-voroshilova";
import { СЛУЧАЙ as с2 } from "./yulia-tkachenko";
import { СЛУЧАЙ as с3 } from "./maria-slavnova";
import { СЛУЧАЙ as с4 } from "./oksana-kuznetsova";
import { СЛУЧАЙ as с5 } from "./roman-savelyev";
import { СЛУЧАЙ as с6 } from "./rustam-aliev";
import { СЛУЧАЙ as с7 } from "./anzhelika-kravtsova";
import { СЛУЧАЙ as с8 } from "./van-hao";
import { СЛУЧАЙ as с9 } from "./grigory-logvinov";
import { СЛУЧАЙ as с10 } from "./egor-borisov";
import { СЛУЧАЙ as с11 } from "./igor-mitin";
import { СЛУЧАЙ as с12 } from "./vitaly-kuznetsov";
import { СЛУЧАЙ as с13 } from "./dzhamshid-akhmedov";
import { СЛУЧАЙ as с14 } from "./stanislav-shvets";
import { СЛУЧАЙ as с15 } from "./tamara-sokolova";
import { СЛУЧАЙ as с16 } from "./nikolay-baranov";
import { СЛУЧАЙ as с17 } from "./mikhail-kravtsov";
import { СЛУЧАЙ as с18 } from "./leonid-gromov";
import { СЛУЧАЙ as с19 } from "./galina-zaytseva";
import { СЛУЧАЙ as с20 } from "./boris-kaplan";

export const ПРЕСЕТ: Preset = {
  clinic: КЛИНИКА,
  cases: [
  с0,
  с1,
  с2,
  с3,
  с4,
  с5,
  с6,
  с7,
  с8,
  с9,
  с10,
  с11,
  с12,
  с13,
  с14,
  с15,
  с16,
  с17,
  с18,
  с19,
  с20,
  ],
};
