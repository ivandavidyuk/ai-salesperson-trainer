"""Прогон одной сцены много раз: проходит ли она и с какой частотой.

Дополняет sim_conversation.py, который гоняет разговор целиком. Гонять все
восемнадцать ходов ради трёх — дорого и медленно, а один прогон ничего
не говорит о частоте: правка промпта может работать в трёх случаях из четырёх
и это будет выглядеть как успех.

История до сцены задана фикстурой (обязательные условия отработаны, порог
взят), и повторяется только сама сцена. Восемь прогонов одной сцены дешевле
и информативнее одного полного разговора.

Запуск внутри backend-контейнера (потолок первого токена настроен под сетевой
путь DE, локально он ложно срабатывает):

    python scripts/sim_scene.py <промпт.txt> [сколько прогонов]
    python scripts/sim_scene.py <промпт.txt> 8 --сцена scenes/dentistry-husband.json
    python scripts/sim_scene.py <промпт.txt> --сухой   # без обращений к модели

Фикстуры лежат в scripts/scenes/. По умолчанию берётся офтальмологическая —
та, на которой сцена с согласующим отлаживалась.

Три оговорки, без которых легко сделать неверный вывод:

  * ФИКСТУРА ДОЛЖНА СООТВЕТСТВОВАТЬ ПРОМПТУ. Офтальмологическая история против
    стоматологического промпта измерит не то: беседа всё равно про зрение,
    и роль возьмёт отраслевые слова из неё, а не из промпта. Скрипт проверяет
    это сам — по списку «маркёры» в фикстуре — и ругается, если не сходится.
    Чистота слоя личности проверяется отдельно, в npm run check:prompts.
  * МЕТКИ РЯДОМ С ОТВЕТАМИ — ПОДСКАЗКА, А НЕ ВЕРДИКТ. Отказ и согласие
    по-русски говорятся десятком способов; отличать их регуляркой надёжно
    не получается. Ответы короткие, их десятки — читать глазами.
  * ИЗОЛИРОВАННАЯ СЦЕНА ОПТИМИСТИЧНЕЕ ПОЛНОГО РАЗГОВОРА. Фикстура подаёт
    историю, где обязательные условия отработаны и порог взят с первого хода,
    то есть пациенту не за что держаться, кроме самой сцены. «Прошла 8 из 8»
    верно для этих условий и на разговор с пропусками не переносится:
    в трёх полных прогонах 30.07 (плохая техника, блиц-закрытие, нетронутый
    страх безопасности) сцена не сработала ни разу — у пациента оставались
    открытые вопросы, и он возвращался к ним вместо решения. Поведение
    защитимое, но частоту прохождения по этому скрипту завышать нельзя:
    он мерит сцену в лучших условиях, а не в среднем разговоре.
"""

import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import get_settings  # noqa: E402
from services import llm  # noqa: E402

# Сколько ждать между попытками, когда провайдер молчит. В бою потерянный ход —
# событие, которое надо видеть; здесь он только портит замер, поэтому
# повторяем терпеливее прода. Потолок первого токена в llm.py не трогаем
_ROLE_ATTEMPTS = 4
_RETRY_PAUSE_SEC = 3.0
# Живые ходы разделены человеческой речью, а симулятор бьёт по API вплотную
# и сам себе устраивает лимит запросов
_TURN_PAUSE_SEC = 1.5

_SCENES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenes")
_DEFAULT_SCENE = os.path.join(_SCENES_DIR, "ophthalmology-husband.json")


class Fixture:
    """История до сцены, сама сцена и подсказки для чтения вывода."""

    def __init__(self, data: dict, path: str):
        self.path = path
        self.title = data.get("название", os.path.basename(path))
        self.markers: list[str] = data.get("маркёры", [])
        self.history: list[tuple[str, str]] = [tuple(row) for row in data["история"]]
        self.scene: list[tuple[str, str]] = [tuple(row) for row in data["сцена"]]
        hints = data.get("подсказки", {})
        self.passed_hints: tuple[str, ...] = tuple(hints.get("пройдена", ()))
        self.agreed_hints: tuple[str, ...] = tuple(hints.get("согласилась", ()))


def load_fixture(path: str) -> Fixture:
    with open(path, encoding="utf-8") as fh:
        return Fixture(json.load(fh), path)


def mentions(text: str, stems) -> bool:
    """Есть ли корень с начала слова. Подстрокой нельзя: «беру» есть в «выберу»."""
    return any(
        re.search(rf"(?<![А-Яа-яЁёA-Za-z]){re.escape(stem)}", text, re.I)
        for stem in stems
    )


def check_fit(prompt: str, fixture: Fixture) -> tuple[list[str], list[str], bool]:
    """Какие маркёры фикстуры нашлись в промпте: (нашлись, нет, годится ли).

    Ровно та ошибка, ради которой проверка написана: прогнать офтальмологическую
    историю против стоматологического промпта и решить, что измерил сцену.
    Разговор в таком прогоне идёт про зрение — из истории, а не из промпта,
    и результат не значит ничего.

    Хватает половины маркёров, а не всех. Требовать все — ложная тревога
    на законном случае: сгенерированный стоматологический промпт 30.07 говорил
    «зуб» и «имплант» по четыре раза, а «коронку» не упоминал вовсе. Чужая
    отрасль при этом не проходит с запасом — у неё совпадений ноль.
    """
    found = [stem for stem in fixture.markers if mentions(prompt, [stem])]
    missing = [stem for stem in fixture.markers if stem not in found]
    fits = not fixture.markers or len(found) * 2 >= len(fixture.markers)
    return found, missing, fits


async def collect_reply(history: list[dict], prompt: str) -> str:
    for attempt in range(1, _ROLE_ATTEMPTS + 1):
        parts: list[str] = []
        try:
            async for delta in llm.stream_reply(history, prompt):
                parts.append(delta)
        except Exception as exc:  # noqa: BLE001
            if attempt == _ROLE_ATTEMPTS:
                print(f"     (провайдер молчит: {type(exc).__name__})")
                return ""
            await asyncio.sleep(_RETRY_PAUSE_SEC)
            continue
        reply = "".join(parts).strip()
        if reply or attempt == _ROLE_ATTEMPTS:
            return reply
        await asyncio.sleep(_RETRY_PAUSE_SEC)
    return ""


def parse_args(argv: list[str]) -> tuple[str, int, str, bool]:
    if not argv:
        sys.exit(__doc__)
    prompt_path = argv[0]
    scene_path = _DEFAULT_SCENE
    dry = False
    runs = 5
    rest = argv[1:]
    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg == "--сцена":
            i += 1
            scene_path = rest[i]
        elif arg == "--сухой":
            dry = True
        else:
            runs = int(arg)
        i += 1
    return prompt_path, runs, scene_path, dry


async def main() -> None:
    prompt_path, runs, scene_path, dry = parse_args(sys.argv[1:])

    with open(prompt_path, encoding="utf-8") as fh:
        role = fh.read()
    fixture = load_fixture(scene_path)

    # Порог взят: обязательные условия в фикстуре отработаны
    prompt = f"{role}\n\n{llm.trust_instruction(True)}"

    print(f"промпт:  {len(role)} символов — {prompt_path}")
    print(f"фикстура: {fixture.title} — {os.path.basename(fixture.path)}")
    print(f"модель:  {get_settings().llm_model}")

    found, missing, fits = check_fit(prompt, fixture)
    total = len(fixture.markers)
    if not fits:
        print(
            f"\n!! ФИКСТУРА НЕ СООТВЕТСТВУЕТ ПРОМПТУ: маркёров {len(found)} из {total}"
        )
        print("   нет в промпте: " + ", ".join(f"«{stem}»" for stem in missing))
        print(
            "   Разговор пойдёт по отрасли из истории, а не из промпта, "
            "и замер ничего не будет значить.\n"
            "   Возьмите фикстуру своей отрасли из scripts/scenes/ "
            "или напишите новую."
        )
        if not dry:
            sys.exit(1)
    else:
        tail = (
            "" if not missing else " (нет: " + ", ".join(f"«{s}»" for s in missing) + ")"
        )
        print(f"сходится: маркёров {len(found)} из {total}{tail}")

    if dry:
        print(f"\nсухой прогон: {len(fixture.history)} реплик истории, "
              f"{len(fixture.scene)} шагов сцены, к модели не обращаемся")
        for label, line in fixture.scene:
            print(f"  [{label}]\n  М: {line}")
        return

    print(f"прогонов: {runs}\n")

    passed = 0
    for run in range(1, runs + 1):
        print(f"{'=' * 74}\nПРОГОН {run}")
        history = [{"role": role_, "text": text} for role_, text in fixture.history]
        scene_passed = False

        for label, line in fixture.scene:
            history.append({"role": "user", "text": line})
            reply = await collect_reply(history, prompt)
            history.append({"role": "assistant", "text": reply})

            hints = []
            if mentions(reply, fixture.passed_hints):
                hints.append("похоже, сцена пройдена")
                scene_passed = True
            if mentions(reply, fixture.agreed_hints):
                hints.append("похоже, согласилась")
            tail = ("  ← " + ", ".join(hints)) if hints else ""

            print(f"\n  [{label}]\n  М: {line}")
            print(f"  Т: {reply or '(пусто)'}{tail}")
            await asyncio.sleep(_TURN_PAUSE_SEC)

        passed += scene_passed
        print()

    print("=" * 74)
    print(f"сцена прошла в {passed} прогонах из {runs}")


if __name__ == "__main__":
    asyncio.run(main())
