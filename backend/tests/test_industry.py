"""Слова отрасли: медицина — тождество, недвижимость — без медицинских слов."""

import re

from services import checklist, industry, llm, scoring

ТЕКСТЫ_МЕДИЦИНЫ = {
    "доверие ниже": llm.trust_instruction(False),
    "доверие выше": llm.trust_instruction(True),
    "чек-лист полный": checklist.rubric_block(checklist.STAGE_KEYS_ALL),
    "чек-лист фоновый": checklist.rubric_block(scoring.STAGE_KEYS, partial=True),
    "чек-лист профилактики": checklist.rubric_block(("prevention",)),
    "чек-лист перехвата": checklist.rubric_block(("intercept",)),
    "своя рубрика": scoring.build_rubric("Оцениваешь тон."),
    "инструкции исхода": scoring._FINAL_INSTRUCTIONS,
    "инструкции упражнения": scoring._DRILL_INSTRUCTIONS,
}


def test_разборщик_отрасли():
    assert industry.industry_key("офтальмология") == industry.МЕДИЦИНА
    assert industry.industry_key("стоматология: терапия и имплантация") == industry.МЕДИЦИНА
    assert industry.industry_key("") == industry.МЕДИЦИНА
    assert industry.industry_key(None) == industry.МЕДИЦИНА
    assert industry.industry_key("Недвижимость: офис продаж застройщика") == industry.НЕДВИЖИМОСТЬ
    assert industry.industry_key("застройщик") == industry.НЕДВИЖИМОСТЬ


def test_результат_диагностики_только_у_клиник():
    assert industry.есть_диагностика("офтальмология")
    assert industry.есть_диагностика("")
    assert industry.есть_диагностика(None)
    assert not industry.есть_диагностика("Недвижимость: офис продаж застройщика")


def test_медицина_не_меняется_ни_на_байт():
    for название, текст in ТЕКСТЫ_МЕДИЦИНЫ.items():
        assert industry.translate(текст, "офтальмология") == текст, название
        assert industry.translate(текст, "") == текст, название


def test_у_клиник_прежние_тексты_через_параметр_отрасли():
    # Параметр отрасли у функций — та же тождественность, что у translate:
    # с ним и без него клиники получают один и тот же текст
    assert llm.trust_instruction(False, "стоматология") == llm.trust_instruction(False)
    assert checklist.rubric_block(checklist.STAGE_KEYS_ALL, industry="офтальмология") == checklist.rubric_block(
        checklist.STAGE_KEYS_ALL
    )
    assert scoring.build_rubric(stages=scoring.STAGE_KEYS, partial=True, industry="офтальмология") == scoring.build_rubric(
        stages=scoring.STAGE_KEYS, partial=True
    )


def test_недвижимость_без_медицинских_слов():
    for название, текст in ТЕКСТЫ_МЕДИЦИНЫ.items():
        перевод = industry.translate(текст, "недвижимость")
        остались = [
            корень
            for корень in industry.МЕДИЦИНСКИЕ_КОРНИ
            if re.search(rf"(?<![А-Яа-яЁё]){корень}", перевод, re.IGNORECASE)
        ]
        assert not остались, f"{название}: {остались}"


def _снимок(отрасль: str = "") -> list[dict]:
    # Все этапы, у перехвата — неизмеренный с причиной: так в снимок
    # попадают и названия, и подсказки, и строка «почему не измерен»
    marks = {key: [1] * checklist.ITEMS_PER_STAGE for key in checklist.STAGE_KEYS_ALL}
    полный = checklist.snapshot(marks, {}, checklist.STAGE_KEYS_ALL, industry=отрасль)
    причина = checklist.UNMEASURED_WHEN["intercept"].reason
    перехват = checklist.snapshot(
        {"intercept": None}, {}, ("intercept",), reason=причина, industry=отрасль
    )
    return полный + перехват


def test_снимок_чек_листа_у_клиник_прежний():
    # Снимок лежит в базе и показывается в разборе: у клиник он обязан
    # совпасть с тем, что писался до перевода, до байта
    assert _снимок("офтальмология") == _снимок()
    assert _снимок("стоматология: терапия и имплантация") == _снимок()


def test_снимок_чек_листа_недвижимости_её_словами():
    снимок = _снимок("Недвижимость: офис продаж застройщика")
    тексты = [строка.get("reason", "") for строка in снимок] + [
        f"{пункт['name']} {пункт['full']}" for строка in снимок for пункт in строка["items"]
    ]
    for текст in тексты:
        остались = [
            корень
            for корень in industry.МЕДИЦИНСКИЕ_КОРНИ
            if re.search(rf"(?<![А-Яа-яЁё]){корень}", текст, re.IGNORECASE)
        ]
        assert not остались, f"{текст}: {остались}"
    названия = [пункт["name"] for строка in снимок for пункт in строка["items"]]
    assert "Задал открытый вопрос о том, что клиент ищет" in названия
    assert "Спросил о человеке, а не о квартире" in названия


def test_недвижимость_говорит_своими_словами():
    ниже = llm.trust_instruction(False, "недвижимость")
    assert "внести бронь" in ниже
    assert "услугу" not in ниже
    рубрика = checklist.rubric_block(checklist.STAGE_KEYS_ALL, industry="недвижимость")
    assert "менеджера отдела продаж застройщика" in рубрика
    assert "клиент" in рубрика and "пациент" not in рубрика
    # Склонение сохраняется: «пациенту» → «клиенту», «пациентка» не ломается
    assert industry.translate("вопрос пациенту и ответ пациентки", "недвижимость") == "вопрос клиенту и ответ клиентки"
    # Латинские идентификаторы в схеме ответа не трогаются
    assert "patientAsked" in industry.translate("поле `patientAsked`", "недвижимость")


def test_сцена_упражнения_по_отрасли():
    base = "Ты пришла в клинику и ждёшь у стойки."
    variants = '{"недвижимость": "Ты пришла в офис продаж и ждёшь у макета."}'
    # У клиники — базовый текст как был, включая слово «клинику»
    assert industry.pick_variant(base, variants, "стоматология") == base
    assert industry.pick_variant(base, "{}", "офтальмология") == base
    # У офиса продаж — свой вариант; JSON и dict — одно и то же
    assert industry.pick_variant(base, variants, "недвижимость").startswith("Ты пришла в офис продаж")
    assert industry.pick_variant(base, {"недвижимость": "макет"}, "застройщик") == "макет"
    # Нет варианта — базовый текст через перевод, без «пациента»
    assert industry.pick_variant("пациент молчит", "{}", "недвижимость") == "клиент молчит"
    # Битый JSON и None не роняют сборку промпта
    assert industry.pick_variant(base, "не json", "недвижимость") == base
    assert industry.pick_variant(base, None, "недвижимость") == base


def test_недвижимость_говорит_о_брони_а_не_об_оплате():
    # Сделка в офисе продаж закрывается бронью. Строка доверия разрешала
    # согласиться на «оплатить», а запрещала «внести бронь» — одно слово
    # на все тексты, иначе роль и оценщик читают разное
    тексты = {
        "доверие выше": llm.trust_instruction(True, "недвижимость"),
        "доверие ниже": llm.trust_instruction(False, "недвижимость"),
        "исход": industry.translate(scoring._FINAL_INSTRUCTIONS, "недвижимость"),
        "упражнение": industry.translate(scoring._DRILL_INSTRUCTIONS, "недвижимость"),
    }
    for название, текст in тексты.items():
        assert not re.search(r"оплатить|об оплате|оплату", текст), название
    assert "предложит внести бронь" in тексты["доверие выше"]


def test_расшифровка_оценщику_словом_отрасли():
    история = [{"role": "user", "text": "Здравствуйте"}, {"role": "assistant", "text": "Добрый день"}]
    assert "[1] Клиент: Добрый день" in checklist.format_numbered(история, "недвижимость")
    assert "Клиент: Добрый день" in scoring.format_transcript(история, "недвижимость")
    # У клиник — как было
    assert checklist.format_numbered(история, "стоматология") == checklist.format_numbered(история)
    assert scoring.format_transcript(история, "стоматология") == scoring.format_transcript(история)


def test_рубрика_упражнения_по_отрасли():
    from services.session import _по_отрасли_или_нет

    база = "Шаги по маршруту: у стойки, по дороге в кабинет. Как обращаться к пациенту."
    свой = '{"недвижимость": "Шаги по маршруту: у входа, к столу переговоров."}'
    # Своя версия отрасли — дословно
    assert _по_отрасли_или_нет(база, свой, "Недвижимость: офис продаж") == (
        "Шаги по маршруту: у входа, к столу переговоров."
    )
    # Своей нет — базовый текст словами отрасли
    assert "к клиенту" in _по_отрасли_или_нет(база, None, "недвижимость")
    # У клиник — прежний текст, есть там вариант недвижимости или нет
    assert _по_отрасли_или_нет(база, свой, "офтальмология") == база
    # Типа нет — None, как было до отраслей
    assert _по_отрасли_или_нет(None, None, "недвижимость") is None
