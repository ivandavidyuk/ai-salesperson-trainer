"""Чистая логика чек-листа: арифметика отметок, сверка цитат и снимок.

Сетевой части здесь нет: как модель ставит отметки, проверяется чтением
реальных разборов (scripts/review_transcript.py), а не тестами.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import checklist
from services.scoring import STAGE_KEYS, build_rubric


def test_двадцать_пять_пунктов_по_пять_на_этап():
    всего = 0
    for key in checklist.STAGE_KEYS_ALL:
        items = checklist.CHECKLIST[key]
        assert len(items) == checklist.ITEMS_PER_STAGE, key
        всего += len(items)
    assert всего == 25
    # Номера сквозные и без дыр — на них ссылается подпись «выполнено N из 25»
    номера = [i.n for key in checklist.STAGE_KEYS_ALL for i in checklist.CHECKLIST[key]]
    assert номера == list(range(1, 26))


def test_первые_четыре_этапа_совпадают_с_полосами_прогресса():
    assert checklist.STAGE_KEYS_ALL[:4] == STAGE_KEYS


def test_оценка_этапа_это_сумма_отметок():
    assert checklist.stage_score([2, 2, 2, 2, 2]) == 10.0
    assert checklist.stage_score([0, 0, 0, 0, 0]) == 0.0
    assert checklist.stage_score([2, 1, 0, 2, 1]) == 6.0


def test_десятка_достижима_и_единица_тоже():
    # Ради этого всё и затевалось: у прежней шкалы верха не было
    assert checklist.stage_score([2] * 5) == 10.0
    assert checklist.stage_score([1, 0, 0, 0, 0]) == 1.0


def test_мусор_в_отметках_это_ноль_а_лишнее_не_считается():
    assert checklist.clamp_mark("выполнено") == 0
    assert checklist.clamp_mark(None) == 0
    assert checklist.clamp_mark(7) == 2
    assert checklist.clamp_mark(-1) == 0
    assert checklist.clamp_mark("2") == 2
    # Шесть отметок вместо пяти не поднимают оценку выше десяти
    assert checklist.stage_score([2, 2, 2, 2, 2, 2]) == 10.0
    # Три отметки — недостающие нули, а не падение
    assert checklist.stage_score([2, 2, 2]) == 6.0


def test_не_измеренный_этап_это_none_а_не_ноль():
    assert checklist.stage_score(None) is None


def test_общая_это_среднее_измеренных():
    assert checklist.overall({"a": 10.0, "b": 8.0, "c": None}) == 9.0
    assert checklist.overall({"a": 7.0, "b": 8.0, "c": 6.0, "d": 9.0, "e": 5.0}) == 7.0
    assert checklist.overall({"a": None}) == 0.0


def test_отметки_по_этапам_из_ответа_модели():
    raw = {"contact": [2, 1, 0, 2, 2], "needs": "мусор"}
    marks = checklist.marks_by_stage(raw, ("contact", "iceBreaker", "needs"))
    assert marks["contact"] == [2, 1, 0, 2, 2]
    # Промолчала про этап — нули: действий не увидела
    assert marks["iceBreaker"] == [0, 0, 0, 0, 0]
    assert marks["needs"] == [0, 0, 0, 0, 0]


def test_не_измерен_решает_код_а_не_модель():
    # Модель прислала отметки за возражения, но пациент не возражал —
    # верить отметкам нельзя, этап None
    raw = {"objections": [2, 2, 2, 2, 2]}
    marks = checklist.marks_by_stage(raw, ("objections",), unmeasured=("objections",))
    assert marks["objections"] is None


_ИСТОРИЯ = [
    {"role": "user", "text": "Джамшид Толибович, здравствуйте! Меня зовут Иван, я администратор."},
    {"role": "assistant", "text": "Спасибо, доехал нормально, час на электричке."},
    {"role": "user", "text": "Шестьдесят тысяч рублей за глаз — в сумму входит всё."},
]


def test_цитата_находится_без_учёта_регистра_и_пунктуации():
    assert checklist.verify_quote("меня зовут иван я администратор", _ИСТОРИЯ) == 0
    assert checklist.verify_quote("Шестьдесят тысяч рублей за глаз", _ИСТОРИЯ) == 2


def test_цитата_с_ё_и_е_равнозначна():
    история = [{"role": "user", "text": "Всё включено, ещё раз повторю."}]
    assert checklist.verify_quote("все включено, еще раз", история) == 0


def test_выдуманная_цитата_отбрасывается():
    assert checklist.verify_quote("Я вам всё объяснил по пунктам", _ИСТОРИЯ) is None


def test_реплика_пациента_не_считается_цитатой_менеджера():
    assert checklist.verify_quote("доехал нормально, час на электричке", _ИСТОРИЯ) is None


def test_слишком_короткая_цитата_не_проверяется():
    # «да» найдётся где угодно — такое совпадение ничего не подтверждает
    assert checklist.verify_quote("Иван", _ИСТОРИЯ) is None
    assert checklist.verify_quote(None, _ИСТОРИЯ) is None
    assert checklist.verify_quote(42, _ИСТОРИЯ) is None


def test_доказательство_номером_реплики_менеджера():
    assert checklist.verify_evidence(0, _ИСТОРИЯ) == 0
    assert checklist.verify_evidence("0", _ИСТОРИЯ) == 0
    # Номер реплики пациента сводится к реплике менеджера перед ней:
    # модель законно ссылается на ответ пациента, а счёт с единицы
    # так лечится сам
    assert checklist.verify_evidence(1, _ИСТОРИЯ) == 0
    assert checklist.verify_evidence("1", _ИСТОРИЯ) == 0
    # Номера, которых нет, и мусор
    assert checklist.verify_evidence(99, _ИСТОРИЯ) is None
    assert checklist.verify_evidence(-1, _ИСТОРИЯ) is None
    assert checklist.verify_evidence(True, _ИСТОРИЯ) is None
    assert checklist.verify_evidence(None, _ИСТОРИЯ) is None


def test_цитата_текстом_остаётся_запасным_доказательством():
    assert checklist.verify_evidence("Меня зовут Иван, я администратор", _ИСТОРИЯ) == 0
    assert checklist.verify_evidence("выдумка", _ИСТОРИЯ) is None


def test_отметка_без_доказательства_сбрасывается_в_ноль():
    marks = {"contact": [2, 0, 1, 2, 1]}
    evidence = {"contact": [0, None, "выдумка", 1, None]}
    grounded, msgs, dropped = checklist.ground(marks, evidence, _ИСТОРИЯ, ("contact",))
    # Первая подтверждена номером, четвёртая — ответом пациента на [0];
    # третья — выдумка, пятая без доказательства: обе в ноль
    assert grounded["contact"] == [2, 0, 0, 2, 0]
    assert msgs["contact"] == [0, None, None, 0, None]
    assert dropped == 2


def test_нулевая_отметка_доказательства_не_требует():
    grounded, msgs, dropped = checklist.ground(
        {"contact": [0, 0, 0, 0, 0]}, None, _ИСТОРИЯ, ("contact",)
    )
    assert grounded["contact"] == [0, 0, 0, 0, 0] and dropped == 0


def test_не_измеренный_этап_проходит_сверку_нетронутым():
    grounded, msgs, dropped = checklist.ground(
        {"objections": None}, {"objections": [0, 0, 0, 0, 0]}, _ИСТОРИЯ, ("objections",)
    )
    assert grounded["objections"] is None and dropped == 0
    assert msgs["objections"] == [None] * 5


def test_нумерованная_расшифровка_ставит_индексы_истории():
    текст = checklist.format_numbered(_ИСТОРИЯ)
    строки = текст.split("\n")
    assert строки[0].startswith("[0] Менеджер: ")
    assert строки[1].startswith("[1] Пациент: ")
    assert len(строки) == len(_ИСТОРИЯ)


def test_снимок_несёт_названия_подсказки_отметки_и_индексы():
    marks = {"contact": [2, 0, 1, 0, 0]}
    msgs = {"contact": [0, None, 2, None, None]}
    snap = checklist.snapshot(marks, msgs, ("contact",))
    assert len(snap) == 1
    stage = snap[0]
    assert stage["stage"] == "contact" and stage["measured"] is True
    assert [i["n"] for i in stage["items"]] == [1, 2, 3, 4, 5]
    assert stage["items"][0]["name"] == "Поздоровался и представился"
    assert stage["items"][0]["full"].startswith("тепло")
    assert stage["items"][0]["mark"] == 2 and stage["items"][0]["msg"] == 0
    assert stage["items"][2]["mark"] == 1 and stage["items"][2]["msg"] == 2
    assert stage["items"][1]["msg"] is None


def test_снимок_не_измеренного_этапа():
    snap = checklist.snapshot({"objections": None}, {}, ("objections",))
    assert snap[0]["measured"] is False
    assert all(i["mark"] == 0 and i["msg"] is None for i in snap[0]["items"])


def test_рубрика_содержит_все_пункты_и_правила():
    текст = build_rubric()
    for key in checklist.STAGE_KEYS_ALL:
        for item in checklist.CHECKLIST[key]:
            assert item.name in текст, item.name
            assert item.full in текст, item.full
    assert "objectionsRaised=false" in текст
    assert "НА КАЖДОМ возражении" in текст
    # Итоговый режим: про «не дошли» ничего, это правило фонового
    assert "ещё не дошёл" not in текст


def test_фоновая_рубрика_говорит_про_недошедшие_этапы_и_без_не_измерен():
    текст = build_rubric(stages=STAGE_KEYS, partial=True)
    assert "ещё не дошёл" in текст
    assert "objectionsRaised" not in текст
    assert "Закрытие сделки" not in текст, "закрытие фоновому оценщику не полагается"


def test_схема_ответа_перечисляет_этапы():
    схема = checklist.marks_schema(("contact", "closing"))
    assert '"contact": [5 отметок 0|1|2]' in схема
    assert '"closing": [5 номеров реплик или null]' in схема
    # Фоновому оценщику доказательства не нужны — и в схеме их нет
    assert "evidence" not in checklist.marks_schema(("contact",), with_evidence=False)


# --- Упражнения без этапа сделки ----------------------------------------------


def test_у_профилактики_и_перехвата_свои_пять_пунктов():
    # До 11.09 у этих двух пунктов не было вовсе: менеджер видел число
    # и вердикт, а из чего сложилось число — ниоткуда
    for key in checklist.DRILL_KEYS:
        items = checklist.CHECKLIST[key]
        assert len(items) == checklist.ITEMS_PER_STAGE, key
        assert all(i.name and i.full for i in items), key


def test_номера_пунктов_сквозные_по_всем_наборам():
    # Номер — то, на что ссылается снимок старого разбора. Дыра или повтор
    # означали бы, что два разных пункта показываются одним номером
    ключи = (*checklist.STAGE_KEYS_ALL, *checklist.DRILL_KEYS)
    номера = [i.n for key in ключи for i in checklist.CHECKLIST[key]]
    assert номера == list(range(1, 36))


def test_у_каждого_набора_есть_название():
    # Без названия падает печать снимка в review_transcript и sim_conversation
    for key in checklist.CHECKLIST:
        assert checklist.TITLES[key]


def test_упражнения_без_этапа_не_попадают_в_полный_разговор():
    # Пятый этап сделки Дима отклонил 03.08: он утянул бы порог доверия
    for key in checklist.DRILL_KEYS:
        assert key not in checklist.STAGE_KEYS_ALL
        assert key not in build_rubric()


def test_рубрика_профилактики_несёт_свои_пункты_и_правило_про_когда():
    текст = build_rubric(stages=("prevention",))
    for item in checklist.CHECKLIST["prevention"]:
        assert item.name in текст, item.name
    # Главное правило упражнения: меряется не «снял ли», а «когда снял»
    assert "снял раньше, чем пациент заговорил" in текст
    assert "Установка контакта" not in текст


def test_рубрика_перехвата_говорит_что_пункты_накопительные():
    текст = build_rubric(stages=("intercept",))
    assert "по ВСЕМ вопросам пациента" in текст
    assert "Вернул вопрос" in текст
    # Без явной шкалы оценщик ставил двойку там, где сам же писал
    # «выполнено на 3 из 4»
    assert "«Три из четырёх» — это 1" in текст


def test_снимок_упражнения_без_этапа():
    marks = {"intercept": [2, 1, 0, 0, 0]}
    msgs = {"intercept": [4, 6, None, None, None]}
    snap = checklist.snapshot(marks, msgs, ("intercept",))
    assert snap[0]["stage"] == "intercept" and snap[0]["measured"] is True
    assert [i["n"] for i in snap[0]["items"]] == [31, 32, 33, 34, 35]
    # Оценка складывается из отметок так же, как у этапных упражнений
    assert checklist.stage_score(marks["intercept"]) == 3.0


def test_пункт_вопрос_не_доказывается_репликой_без_вопроса():
    # 11.09 оценщик поставил перехвату 10 из 10, сославшись всеми пятью
    # пунктами на одну реплику без вопроса — в разговоре, где менеджер
    # не спросил ни разу
    история = [
        {"role": "user", "text": "Понимаю вас, это обычная картина при помутнении."},
        {"role": "assistant", "text": "А долго восстанавливаться?"},
    ]
    marks = {"intercept": [2, 2, 2, 2, 2]}
    evidence = {"intercept": [0, 0, 0, 0, 0]}
    grounded, msgs, dropped = checklist.ground(marks, evidence, история, ("intercept",))
    # 32 и 33 — это вопрос менеджера, и реплика без «?» их не подтверждает
    assert grounded["intercept"][1] == 0 and msgs["intercept"][1] is None
    assert grounded["intercept"][2] == 0 and msgs["intercept"][2] is None
    # Остальные три отметки эта проверка не трогает: их доказывает смысл
    assert grounded["intercept"][0] == 2
    assert dropped == 2


def test_реплика_с_вопросом_пункт_вопрос_подтверждает():
    история = [
        {"role": "user", "text": "Двадцать минут. А вас что беспокоит больше?"},
        {"role": "assistant", "text": "Боюсь, что станет хуже."},
    ]
    marks = {"intercept": [0, 2, 2, 0, 0]}
    evidence = {"intercept": [None, 0, 0, None, None]}
    grounded, msgs, dropped = checklist.ground(marks, evidence, история, ("intercept",))
    assert grounded["intercept"][1] == 2 and msgs["intercept"][1] == 0
    assert grounded["intercept"][2] == 2
    assert dropped == 0


def test_правило_профилактики_называет_свою_точку_отсчёта():
    текст = build_rubric(stages=("prevention",))
    assert "ИМЕННО ОБ ЭТОМ сомнении" in текст
    # 11.09 оценщик обнулил «назвал цену сам» на том, что пациент перед этим
    # спросил про внуков: чужой вопрос точкой отсчёта быть не может
    assert "Другие вопросы пациента к ней" in текст


def test_промпт_полного_разговора_не_изменился_правилами_упражнений():
    # Двадцать пять пунктов считаны на 92 разговорах, и на них стоит порог
    # доверия. Правила упражнений в их промпт попадать не должны
    полный = build_rubric()
    assert "Одной и той же репликой" not in полный
    assert "ИМЕННО ОБ ЭТОМ сомнении" not in полный
    assert "по ВСЕМ вопросам пациента" not in полный
    # А в промпте упражнения правило есть
    assert "Одной и той же репликой" in build_rubric(stages=("intercept",))


def test_вопрос_без_знака_засчитывается_прямой_просьбой():
    # «Расскажите, что вас тревожит» — вопрос по делу, а знака в нём нет.
    # Живая речь его не ставит, и STT тем более
    assert checklist.есть_вопрос("А с чем связан вопрос?")
    assert checklist.есть_вопрос("Расскажите, что вас тревожит")
    assert checklist.есть_вопрос("Скажите, а как вам удобнее")
    assert not checklist.есть_вопрос("Понимаю вас, это обычная картина.")
    assert not checklist.есть_вопрос("Двадцать минут, под каплями.")


def test_пункт_вопрос_принимает_реплику_с_просьбой_рассказать():
    история = [
        {"role": "user", "text": "Расскажите, что вас в этом тревожит"},
        {"role": "assistant", "text": "Боюсь, что станет хуже."},
    ]
    grounded, msgs, dropped = checklist.ground(
        {"intercept": [0, 2, 0, 0, 0]}, {"intercept": [None, 0, None, None, None]},
        история, ("intercept",)
    )
    assert grounded["intercept"][1] == 2 and dropped == 0


def test_неизмеренное_упражнение_несёт_причину():
    # Иначе пустые пункты читаются как обвинение
    причина = checklist.UNMEASURED_WHEN["intercept"].reason
    snap = checklist.snapshot({"intercept": None}, {}, ("intercept",), reason=причина)
    assert snap[0]["measured"] is False
    assert snap[0]["reason"] == причина
    # У измеренного причины нет вовсе — показывать нечего
    без = checklist.snapshot({"intercept": [2, 0, 0, 0, 0]}, {}, ("intercept",), reason=причина)
    assert "reason" not in без[0]


def test_условие_несостоявшегося_упражнения_только_у_перехвата():
    # У профилактики всегда есть что снять заранее, поводов не мерить нет
    assert set(checklist.UNMEASURED_WHEN) == {"intercept"}
    assert "patientAsked" in build_rubric(stages=("intercept",))
