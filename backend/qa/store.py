"""Пациенты и типы тренировки — из базы, тем же порядком, что в бою.

Не из выгруженных файлов. Я трижды рисковал прогнать проверку по копии
промпта, устаревшей на день: сид перезаписывает базу, а копия остаётся
лежать и молчит об этом. Инструмент, который проверяет не то, что у людей,
хуже отсутствия инструмента.
"""

import json
import re
from dataclasses import dataclass
from typing import Optional

import asyncpg

from core.config import get_settings

# Слаг пациента живёт в репозитории (frontend/scripts/patients/<слаг>.ts),
# а в базе его нет — там только имя. Соответствие держим здесь явным списком:
# по нему называются файлы результатов и ищется сценарий полного разговора.
#
# Молча пропускать пациента без слага нельзя: он выпадет из матрицы, и
# проверка тихо станет неполной. Поэтому при расхождении инструмент ругается.
СЛАГИ: dict[str, str] = {
    "Анжелика Сергеевна": "anzhelika-kravtsova",
    "Борис Семёнович": "boris-kaplan",
    "Ван Хао": "van-hao",
    "Виталий Эдуардович": "vitaly-kuznetsov",
    "Галина Петровна": "galina-zaytseva",
    "Григорий Игоревич": "grigory-logvinov",
    "Гульсара Рустамовна": "gulsara-karimova",
    "Джамшид Толибович": "dzhamshid-akhmedov",
    "Егор Алексеевич": "egor-borisov",
    "Елена Андреевна": "elena-voroshilova",
    "Игорь Владимирович": "igor-mitin",
    "Леонид Петрович": "leonid-gromov",
    "Мария Андреевна": "maria-slavnova",
    "Михаил Данилович": "mikhail-kravtsov",
    "Николай Васильевич": "nikolay-baranov",
    "Оксана Викторовна": "oksana-kuznetsova",
    "Роман Игоревич": "roman-savelyev",
    "Рустам Каримович": "rustam-aliev",
    "Станислав Геннадьевич": "stanislav-shvets",
    "Тамара Михайловна": "tamara-sokolova",
    "Юлия Андреевна": "yulia-tkachenko",
}

# Роль пациента ровно как её собирает бой (services/session.py): сначала
# случай под клинику, при его отсутствии — промпт из сида. На проде случаев
# нет вовсе, и COALESCE отдаёт сидовый промпт — то же, что услышит менеджер
_ПАЦИЕНТЫ = (
    'SELECT p."id", p."name", '
    'COALESCE(pc."prompt", p."prompt") AS prompt, '
    # Анамнез и карточка — то, что менеджер видит на экране до разговора.
    # Берутся тем же COALESCE, что и промпт: иначе менеджер читал бы
    # исходный анамнез, а роль играла случай клиники
    'COALESCE(pc."anamnesis", p."anamnesis") AS anamnesis, '
    'COALESCE(pc."description", p."description") AS description, '
    '(pc."prompt" IS NOT NULL) AS case_generated '
    'FROM "Patient" p '
    'LEFT JOIN "PatientCase" pc '
    '  ON pc."patientId" = p."id" AND pc."organizationId" = $1 '
    'WHERE p."isActive" = true '
    'ORDER BY p."name"'
)

# Клиника и прайс: менеджер в ней работает и услуги знает наизусть.
# Без этого симулятор выдумывал услугу — 10.08 продавал Виталию лазерную
# коррекцию за 45 000, тогда как в его случае подбор очков от 3 500, и снять
# страх «как линзы выдержат пыль на стройке» было нечем в принципе
_КЛИНИКА = (
    'SELECT o."name", o."industry", '
    '  COALESCE(json_agg(json_build_object('
    '    \'name\', s."name", \'price\', s."price", \'description\', s."description"'
    '  ) ORDER BY s."position") FILTER (WHERE s."id" IS NOT NULL), \'[]\') AS services '
    'FROM "Organization" o '
    'LEFT JOIN "Service" s ON s."organizationId" = o."id" '
    'WHERE o."id" = $1 '
    'GROUP BY o."id", o."name", o."industry"'
)

_ТИПЫ = (
    'SELECT "id", "title", "description", "prompt", "rubric", "doneWhen", '
    '"stageKey", "scoresDeal" '
    'FROM "TrainingType" WHERE "isActive" = true ORDER BY "position"'
)


@dataclass
class Пациент:
    слаг: str
    имя: str
    промпт: str
    случай_собран: bool
    # Что менеджер видит на экране до разговора. Промпт роли ему не показываем
    # никогда: там условия согласия, и с ними прогон проверял бы не навык,
    # а умение прочитать ответы
    анамнез: str = ""
    карточка: str = ""


@dataclass
class Клиника:
    название: str
    отрасль: str
    услуги: list[dict]

    def прайс(self) -> str:
        """Услуги строками — как менеджер держит их в голове."""
        строки = []
        for у in self.услуги:
            описание = (у.get("description") or "").strip()
            строки.append(
                f"- {у.get('name')} — {у.get('price')}"
                + (f". {описание}" if описание else "")
            )
        return "\n".join(строки)


@dataclass
class ТипТренировки:
    слаг: str
    название: str
    описание: str
    промпт: str
    рубрика: str
    критерий: str
    ключ_этапа: Optional[str]
    считает_сделку: bool


def _слаг(имя: str) -> str:
    """Слаг по имени; для незнакомых — из транслитерации, чтобы не падать."""
    if имя in СЛАГИ:
        return СЛАГИ[имя]
    очищенное = re.sub(r"[^А-Яа-яЁёA-Za-z0-9]+", "-", имя).strip("-").lower()
    return f"неизвестный-{очищенное}"


async def загрузить(
    organization_id: Optional[str] = None,
) -> tuple[list[Пациент], list[ТипТренировки], Optional[Клиника], list[str]]:
    """Пациенты, типы, клиника и список замечаний к данным.

    Замечания возвращаются, а не логируются молча: пациент без промпта или
    без слага выпадет из матрицы, и об этом надо сказать в сводке, иначе
    проверка окажется неполной незаметно.
    """
    settings = get_settings()
    pool = await asyncpg.create_pool(dsn=settings.asyncpg_dsn, min_size=1, max_size=2)
    try:
        if organization_id is None:
            строка = await pool.fetchrow('SELECT "id" FROM "Organization" LIMIT 1')
            organization_id = строка["id"] if строка else None
        пациенты_строки = await pool.fetch(_ПАЦИЕНТЫ, organization_id)
        типы_строки = await pool.fetch(_ТИПЫ)
        строка_клиники = (
            await pool.fetchrow(_КЛИНИКА, organization_id) if organization_id else None
        )
    finally:
        await pool.close()

    клиника = (
        Клиника(
            название=строка_клиники["name"],
            отрасль=строка_клиники["industry"],
            услуги=json.loads(строка_клиники["services"]),
        )
        if строка_клиники
        else None
    )

    замечания: list[str] = []
    пациенты: list[Пациент] = []
    for строка in пациенты_строки:
        промпт = (строка["prompt"] or "").strip()
        if not промпт:
            замечания.append(
                f"у пациента «{строка['name']}» пустой промпт — в матрицу не берём"
            )
            continue
        if строка["name"] not in СЛАГИ:
            замечания.append(
                f"пациента «{строка['name']}» нет в qa/store.py:СЛАГИ — "
                "имя файла результата будет временным, добавьте его в список"
            )
        пациенты.append(
            Пациент(
                слаг=_слаг(строка["name"]),
                имя=строка["name"],
                промпт=промпт,
                случай_собран=строка["case_generated"],
                анамнез=(строка["anamnesis"] or "").strip(),
                карточка=(строка["description"] or "").strip(),
            )
        )

    типы = [
        ТипТренировки(
            слаг=строка["id"],
            название=строка["title"],
            описание=строка["description"],
            промпт=строка["prompt"],
            рубрика=строка["rubric"],
            критерий=строка["doneWhen"],
            ключ_этапа=строка["stageKey"],
            считает_сделку=строка["scoresDeal"],
        )
        for строка in типы_строки
    ]

    # Сверяем со ВСЕМИ строками из базы, а не с отобранными: пациент
    # с пустым промптом уже отмечен выше, и второе замечание про него
    # только запутает
    из_базы = {строка["name"] for строка in пациенты_строки}
    for имя in sorted(set(СЛАГИ) - из_базы):
        замечания.append(
            f"«{имя}» есть в qa/store.py:СЛАГИ, но не пришёл из базы — "
            "пациента переименовали, скрыли или удалили"
        )

    return пациенты, типы, клиника, замечания
