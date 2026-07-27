"""Оценка разговора: порог допуска по ходу и разбор после завершения.

Два оценщика с разными задачами.

**Фоновый** считает четыре этапа после каждого хода. Его результат нужен
не для отчёта, а для решения роли: пока средняя ниже порога, пациент
отказывает при любом предложении оплатить. Работает вне критического пути —
голосовой пайплайн его не ждёт.

**Итоговый** запускается после разговора: определяет исход, ставит пять
оценок и пишет выводы. Он *записывает* исход, а не перерешает его — решение
уже прозвучало в диалоге, оценщик читает, что ответил пациент.

Рубрика этапов общая для всех пациентов и живёт здесь, а не в промпте:
от неё зависит сопоставимость оценок в недельном «Прогрессе» и статистике
отдела, где средние считаются по разным пациентам.

Подробности механизма — в DEAL-OUTCOME.md.
"""

import json
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# Отдельный клиент от llm.py: у оценщика длинные запросы и своя таймаутная
# политика, и он не должен занимать соединения голосового пайплайна
_client = httpx.AsyncClient(timeout=60)

# Этапы в том же порядке, что и в STAGE_METRICS на фронте
STAGE_KEYS = ("contact", "iceBreaker", "needs", "objections")

_RUBRIC = """Ты оцениваешь работу менеджера по продажам медицинских услуг.

Шкала 0–10 для каждого этапа:
0–3 — этап фактически провален или не состоялся
4–6 — сделано формально, без глубины
7–8 — сделано профессионально
9–10 — образцово

ЭТАПЫ:
- contact: установка контакта. Поздоровался, представился, задал тон;
  говорил спокойно, не давил, не перебивал.
- iceBreaker: снятие напряжения. Расположил к себе, дал человеку
  освоиться, проявил участие без заискивания.
- needs: выявление потребности. Открытые вопросы, слушание; докопался
  до того, что мешает пациенту в его жизни, а не только до симптомов.
- objections: отработка возражений. Услышал возражение, ответил по сути
  фактами и выгодой, а не отмахнулся и не начал давить.

Оценивай только то, что видно в расшифровке. Не додумывай интонации."""


@dataclass
class StageScores:
    contact: float
    iceBreaker: float  # noqa: N815 — совпадает с ключом в JSON и на фронте
    needs: float
    objections: float

    @property
    def average(self) -> float:
        """Средняя по четырём этапам — она и сравнивается с порогом.

        Закрытие сюда не входит: до закрытия оценивать нечего.
        """
        values = (self.contact, self.iceBreaker, self.needs, self.objections)
        return round(sum(values) / len(values), 2)

    def as_dict(self) -> dict:
        return {
            "contact": self.contact,
            "iceBreaker": self.iceBreaker,
            "needs": self.needs,
            "objections": self.objections,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "StageScores":
        return cls(
            contact=_clamp(raw.get("contact")),
            iceBreaker=_clamp(raw.get("iceBreaker")),
            needs=_clamp(raw.get("needs")),
            objections=_clamp(raw.get("objections")),
        )


def _clamp(value: object) -> float:
    """Приводит оценку к 0–10. Модель иногда возвращает строку или мусор."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(10.0, number)), 1)


def format_transcript(history: list[dict]) -> str:
    """Расшифровка в виде, пригодном для чтения моделью."""
    lines = []
    for item in history:
        who = "Менеджер" if item.get("role") == "user" else "Пациент"
        lines.append(f"{who}: {item.get('text', '')}")
    return "\n".join(lines)


async def _ask(messages: list[dict], *, purpose: str) -> Optional[dict]:
    """Запрос к модели-оценщику. Возвращает разобранный JSON или None.

    Никогда не бросает: оценка не имеет права влиять на разговор.
    """
    settings = get_settings()
    if not settings.llm_api_key:
        logger.warning("Оценщик (%s): нет ключа LLM", purpose)
        return None

    payload = {
        "model": settings.scorer_model,
        "messages": messages,
        "temperature": 0.2,  # судейство должно быть воспроизводимым
        "response_format": {"type": "json_object"},
        # В отличие от роли, размышление здесь включено: задержка не важна,
        # а устойчивость суждения — главное
        "reasoning": {"enabled": True},
    }

    try:
        response = await _client.post(
            f"{settings.llm_base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Оценщик (%s) не ответил: %s", purpose, exc)
        return None


async def score_stages(
    history: list[dict], patient_role: Optional[str] = None
) -> Optional[StageScores]:
    """Фоновая оценка четырёх этапов по накопленной расшифровке.

    `patient_role` — роль пациента: что его беспокоит и чего он боится.
    Без неё нельзя судить, докопался ли менеджер до настоящей боли, а не
    до симптомов. Рубрика при этом остаётся общей — иначе оценки разных
    пациентов станут несопоставимы, а они складываются в недельный
    «Прогресс» и статистику отдела.
    """
    if not history:
        return None

    context = (
        "\n\nКОГО ИГРАЕТ ПАЦИЕНТ — по этому тексту видно, что менеджер должен "
        f"был выяснить и какие страхи снять. Оцениваешь всё равно менеджера, "
        f"не пациента:\n{patient_role}"
        if patient_role
        else ""
    )
    result = await _ask(
        [
            {"role": "system", "content": _RUBRIC + context},
            {
                "role": "user",
                "content": (
                    "Расшифровка разговора:\n\n"
                    f"{format_transcript(history)}\n\n"
                    "Верни JSON: "
                    '{"contact": число, "iceBreaker": число, '
                    '"needs": число, "objections": число}'
                ),
            },
        ],
        purpose="этапы",
    )
    if result is None:
        return None
    return StageScores.from_dict(result)


@dataclass
class FinalReview:
    """Итог разговора: исход, пять оценок и выводы."""

    outcome: str  # paid | refused | not_asked
    stages: StageScores
    closing: float
    overall: float
    strength: str
    growth_point: str
    judge_notes: str


_OUTCOMES = ("paid", "refused", "not_asked")

_FINAL_INSTRUCTIONS = """Кроме оценки этапов определи ИСХОД разговора.

Исход — это факт из диалога, а не твоё суждение о качестве работы.
Читай, что ответил пациент, и выбери одно:
- "paid" — пациент согласился оплатить услугу;
- "refused" — менеджер предложил оплатить, пациент отказался или уклонился;
- "not_asked" — менеджер так и не предложил оплатить.

Предложение об оплате распознавай ПО СМЫСЛУ. «Оформляем?», «готовы
оплатить?», «записываю вас на операцию» — всё это предложения. Никаких
дословных совпадений и ключевых слов.

"refused" и "not_asked" — разные вещи, не путай их: в одном случае менеджер
дошёл до предложения, в другом нет.

Оцени также этап closing — как менеджер вёл к решению и просил о нём.
Если предложения не было, closing низкий.

ВЫВОДЫ для менеджера:
- strength — что действительно получилось. Честно: если разговор провален,
  назови то, что вышло, но не выдумывай похвалу.
- growthPoint — направление роста, опираясь на конкретный момент разговора.
  НЕ инструкция, что сказать в следующий раз, и не перечень условий:
  менеджер не должен получить готовый ответ.
  ЦЕЛЬСЯ В НАСТОЯЩУЮ ПРИЧИНУ. Пациент отказывает по разным поводам,
  и путать их нельзя:
  • средняя по первым четырём этапам ниже порога {threshold} — разговор
    вёлся слабо. Пиши про технику: темп, слушание, контакт. НЕ про
    аргументы: с ними могло быть всё в порядке, и совет про них
    прозвучит несправедливо;
  • средняя выше порога, но остался неснятый страх — пиши про этот страх,
    без готовых формулировок;
  • предложения об оплате не было — прямо об этом, остальное вторично.

  Среднюю посчитай сам по выставленным тобой оценкам contact, iceBreaker,
  needs, objections. Закрытие в неё не входит.

judgeNotes — служебное поле, менеджер его не увидит. Перечисли, какие
обязательные условия пациента сняты, а какие нет, и одной фразой почему."""


async def review_conversation(
    history: list[dict], patient_prompt: str
) -> Optional[FinalReview]:
    """Итоговый разбор после разговора.

    Получает промпт пациента целиком — тот же текст, что был у роли, включая
    условия согласия. Проверка идёт по тем же условиям, которые были
    у персонажа, а не по вкусу модели.
    """
    if not history:
        return None

    # Порог подставляется в инструкции: без него оценщик не сможет отличить
    # «отказала из-за слабой техники» от «отказала из-за неснятого страха»,
    # а это разные советы менеджеру
    threshold = get_settings().deal_score_threshold
    result = await _ask(
        [
            {
                "role": "system",
                "content": (
                    f"{_RUBRIC}\n\n"
                    f"{_FINAL_INSTRUCTIONS.replace('{threshold}', str(threshold))}"
                ),
            },
            {
                "role": "user",
                "content": (
                    "РОЛЬ ПАЦИЕНТА (по ней он и играл, здесь же условия "
                    f"его согласия):\n\n{patient_prompt}\n\n"
                    "РАСШИФРОВКА РАЗГОВОРА:\n\n"
                    f"{format_transcript(history)}\n\n"
                    "Верни JSON: {"
                    '"outcome": "paid" | "refused" | "not_asked", '
                    '"contact": число, "iceBreaker": число, "needs": число, '
                    '"objections": число, "closing": число, '
                    '"strength": "строка", "growthPoint": "строка", '
                    '"judgeNotes": "строка"}'
                ),
            },
        ],
        purpose="итог",
    )
    if result is None:
        return None

    outcome = str(result.get("outcome", "")).strip()
    if outcome not in _OUTCOMES:
        # Модель придумала своё значение — честнее не записать ничего,
        # чем записать выдуманный исход
        logger.warning("Оценщик вернул неизвестный исход %r", outcome)
        return None

    stages = StageScores.from_dict(result)
    closing = _clamp(result.get("closing"))
    # Общая оценка включает закрытие: она про весь разговор, в отличие
    # от средней-порога, которая смотрит только на работу до закрытия
    overall = round((sum(stages.as_dict().values()) + closing) / 5, 1)

    return FinalReview(
        outcome=outcome,
        stages=stages,
        closing=closing,
        overall=overall,
        strength=str(result.get("strength", "")).strip(),
        growth_point=str(result.get("growthPoint", "")).strip(),
        judge_notes=str(result.get("judgeNotes", "")).strip(),
    )
