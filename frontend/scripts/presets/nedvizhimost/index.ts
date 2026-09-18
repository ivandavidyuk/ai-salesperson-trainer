// Недвижимость: офис продаж застройщика и случаи покупателей.
//
// Набор полный с 18.09: двадцать случаев — тринадцать личностей библиотеки
// и семь новых, написанных под отрасль (состав — docs/Каркас недвижимости.md;
// Григорий Игоревич исключён: его скрытый сюжет на отрасль не ложится).
// Признак `inProgress` снят: неполный набор сид и проверки больше не пропустят.

import type { Preset } from "../types";
import { КЛИНИКА } from "./clinic";
import { СЛУЧАЙ as ТАМАРА } from "./tamara-sokolova";
import { СЛУЧАЙ as ДАРЬЯ } from "./darya-melnikova";
import { СЛУЧАЙ as ПАВЕЛ } from "./pavel-klimov";
import { СЛУЧАЙ as АРТЁМ } from "./artem-kovalev";
import { СЛУЧАЙ as ОЛЕГ } from "./oleg-shestakov";
import { СЛУЧАЙ as СВЕТЛАНА } from "./svetlana-belova";
import { СЛУЧАЙ as ДЕНИС } from "./denis-vorontsov";
import { СЛУЧАЙ as КРИСТИНА } from "./kristina-orlova";
import { СЛУЧАЙ as ЮЛИЯ } from "./yulia-tkachenko";
import { СЛУЧАЙ as ВИТАЛИЙ } from "./vitaly-kuznetsov";
import { СЛУЧАЙ as РУСТАМ } from "./rustam-aliev";
import { СЛУЧАЙ as ВАН_ХАО } from "./van-hao";
import { СЛУЧАЙ as НИКОЛАЙ } from "./nikolay-baranov";
import { СЛУЧАЙ as ИГОРЬ } from "./igor-mitin";
import { СЛУЧАЙ as ЕЛЕНА } from "./elena-voroshilova";
import { СЛУЧАЙ as СТАНИСЛАВ } from "./stanislav-shvets";
import { СЛУЧАЙ as ДЖАМШИД } from "./dzhamshid-akhmedov";
import { СЛУЧАЙ as ЛЕОНИД } from "./leonid-gromov";
import { СЛУЧАЙ as ЕГОР } from "./egor-borisov";
import { СЛУЧАЙ as МИХАИЛ } from "./mikhail-kravtsov";

export const ПРЕСЕТ: Preset = {
  clinic: КЛИНИКА,
  cases: [
    ТАМАРА, ДАРЬЯ, ПАВЕЛ, АРТЁМ, ОЛЕГ, СВЕТЛАНА, ДЕНИС, КРИСТИНА,
    ЮЛИЯ, ВИТАЛИЙ, РУСТАМ, ВАН_ХАО, НИКОЛАЙ, ИГОРЬ, ЕЛЕНА,
    СТАНИСЛАВ, ДЖАМШИД, ЛЕОНИД, ЕГОР, МИХАИЛ,
  ],
};
