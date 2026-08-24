# -*- coding: utf-8 -*-
"""Портреты пациентов для карточек и экрана звонка.

Запуск (ключ OpenRouter живёт в контейнере, наружу не выходит):

    docker exec ai-trainer-backend-1 python /app/scripts/make_portraits.py
    docker exec -e "ТОЛЬКО=boris-kaplan,van-hao" ... — перегенерить выборочно
    docker exec -e ЖАТЬ=1 ...                      — ещё и сжать в webp

Люди вымышленные: описания собраны из личностей в
`frontend/scripts/patients/`, ни на кого конкретного не похожи и похожими
быть не должны.

**Единый стиль важнее отдельного лица.** Двадцать одна карточка стоит рядом
в списке «Пациенты», и разнобой в свете, фоне и крупности читается как
коллаж из стоков. Поэтому в СТИЛЕ жёстко закреплены фон, кадр и тон —
и три запрета, оплаченных пробными заходами:

1. «чтобы пережило круглую обрезку» модель поняла буквально и прислала
   круг с белыми углами. Теперь обрезка запрещена прямым текстом;
2. без описания фона получились кабинет с полками, штора и заводской цех;
3. «documentary style» модель через раз читает как плёнку — и снимок
   выпадает из ряда тёплым зерном.

Цена замерена, а не взята из прайса: $0.068 за картинку (1120 токенов
изображения по $60/M плюс текст). Скрипт печатает фактическую стоимость
каждого вызова — она приходит от OpenRouter вместе с ответом.

**Медицины в портретах нет.** Личность одна на все клиники, случай под
отрасль пишет генератор. Халат, кабинет и приборы привязали бы человека
к офтальмологии навсегда.
"""
import base64
import json
import os
import re
import sys

sys.path.insert(0, "/app")

import httpx  # noqa: E402

from core.config import get_settings  # noqa: E402

МОДЕЛЬ = os.environ.get("МОДЕЛЬ", "google/gemini-3.1-flash-image")
ВЫХОД = os.environ.get("ВЫХОД", "/tmp/portraits")
# Хватает на самый крупный вывод — 168 px на экране звонка при удвоенной
# плотности пикселей
СТОРОНА = 384

# Общая часть — она и держит серию вместе
СТИЛЬ = (
    "Photorealistic portrait photograph, head and shoulders, centered, "
    "facing the camera, neutral calm friendly expression, direct eye contact. "
    # Одному пациенту модель прислала сетку из девяти вариантов вместо кадра
    "Produce EXACTLY ONE photograph of ONE person. Never a grid, a collage, "
    "a contact sheet, a diptych or several variants in one image. "
    # Один потянул руку к воротнику и выпал из ряда
    "Arms hang down out of shot; no hands, fingers or gestures visible. "
    "FRAMING, identical for every image: the head occupies roughly 45 percent "
    "of the frame height, the top of the head sits about 10 percent below the "
    "upper edge, the crop ends at mid-chest. "
    "The image must be a FULL SQUARE photograph filling the entire frame from "
    "edge to edge. Do NOT crop it into a circle or an oval. No white corners, "
    "no rounded corners, no vignette, no border, no frame, no padding. "
    "BACKGROUND, identical for every image: a plain softly blurred interior "
    "wall in MEDIUM-TONE warm neutral grey-beige — never white, never bright, "
    "never dark, the same shade regardless of what the person wears — "
    "evenly lit, completely empty, with no visible corner, edge or cast "
    "shadow. No "
    "furniture, no shelves, no books, no windows, no curtains, no plants, "
    "no machinery, no other people, no recognisable location. "
    "Soft even daylight from the front, no harsh shadows. "
    "Modern digital photograph, neutral accurate colour, clean and sharp, "
    "no film emulation, no film grain, no sepia or warm colour cast, "
    "no vintage look. Natural skin texture, no retouching, no glamour "
    "lighting. Ordinary everyday clothing, no uniforms, no medical coats, "
    "no medical equipment. "
    "The person is fictional and must not resemble any real or public figure. "
    "No text, no watermarks, no props, no logos."
)

# Ключ — имя файла личности в frontend/scripts/patients/.
# Порядок тот же, что в index.ts: так проще сверять глазами
ЛЮДИ = {
    "tamara-sokolova":
        "A 62-year-old Russian woman, retired schoolteacher, now a homemaker "
        "and grandmother. Short greying hair, soft rounded face, gentle and "
        "slightly anxious expression, watchful eyes. Simple knitted cardigan "
        "over a plain blouse.",
    "yulia-tkachenko":
        "A 34-year-old Russian woman, head of a sales department, working "
        "twelve-hour days and raising a teenage daughter alone. Dark hair "
        "pulled back neatly, sharp intelligent face, visible tiredness under "
        "the eyes, composed and businesslike. Plain dark blazer over a top.",
    "vitaly-kuznetsov":
        "A 49-year-old Russian man, owner of a small finishing-work crew who "
        "still works on site himself. Heavy build, broad weathered face, "
        "short greying hair, blunt and direct expression, big rough hands. "
        "Plain dark zip-up jacket over a shirt.",
    "rustam-aliev":
        "A 42-year-old Uzbek man living in Russia, chief engineer on a "
        "construction site. Short dark hair, neat trimmed beard, calm "
        "dignified and polite expression, unhurried. Plain button-up shirt.",
    "van-hao":
        "A 44-year-old Chinese man living in Russia, owner of a small "
        "building-materials factory. Short black hair, calm reserved "
        "businesslike expression, unhurried and observant. Plain dark "
        "business shirt without a tie.",
    "nikolay-baranov":
        "A 71-year-old Russian man, retired artillery colonel. Close-cropped "
        "grey hair, square jaw, upright military bearing, stern direct "
        "unsmiling gaze. Plain dark civilian jacket over a shirt buttoned to "
        "the top.",
    "boris-kaplan":
        "An 83-year-old Russian man, retired surgeon and professor. Thin grey "
        "hair, deeply lined face, sharp attentive eyes behind thin-rimmed "
        "glasses. Dry, composed, slightly sceptical expression — a man used "
        "to being the most knowledgeable person in the room. Plain dark "
        "cardigan over a shirt.",
    "oksana-kuznetsova":
        "A 38-year-old Russian woman, receptionist at a beauty salon, worn "
        "down by years of debt. Dyed blonde hair with dark roots showing, "
        "tired face with careful everyday makeup, guarded expression that "
        "asks for sympathy. Simple knit top.",
    "anzhelika-kravtsova":
        "A 44-year-old Russian woman, homemaker, outwardly well-kept and "
        "comfortable. Shoulder-length dyed light-brown hair, neat, quiet "
        "tension around the eyes. Polite guarded half-smile that does not "
        "quite reach the eyes. Simple blouse, small unobtrusive earrings.",
    "igor-mitin":
        "A 48-year-old Russian man, successful criminal defence lawyer. "
        "Well-groomed dark hair going grey at the temples, heavy confident "
        "face, faint superior smile, dominant appraising stare. Expensive "
        "dark suit jacket over an open-collared white shirt.",
    "stanislav-shvets":
        "A 55-year-old Russian man, former security-service officer now "
        "running a private detective agency. Short grey hair, hard flat "
        "face, narrow watchful eyes that seem to be checking the viewer. "
        "Plain dark jacket over a shirt.",
    "gulsara-karimova":
        "A 25-year-old Uzbek woman living in Russia, mother of two small "
        "children. Young round face without makeup, dark eyes lowered "
        "slightly, shy and reserved expression. Wearing a plain patterned "
        "headscarf covering her hair and a simple long-sleeved dress.",
    "dzhamshid-akhmedov":
        "A 50-year-old man born in Uzbekistan and long settled in Russia, "
        "long-haul truck driver and strict head of a large family. Short "
        "greying hair, short grey beard, weathered serious face, steady "
        "unsmiling gaze. Plain dark sweater.",
    "leonid-gromov":
        "A 74-year-old Russian man from Siberia, retired field geologist. "
        "Thick white hair and a bushy white moustache, ruddy weather-beaten "
        "face, deep laugh lines, warm amused expression as if about to make "
        "a joke. Checked flannel shirt.",
    "egor-borisov":
        "A 47-year-old Russian man, trolleybus driver in a provincial city. "
        "Short brown hair receding slightly, plain honest face, steady direct "
        "gaze that studies the viewer, guarded but not unkind. Simple grey "
        "sweater over a collared shirt.",
    "mikhail-kravtsov":
        "A 72-year-old Russian man, retired military pilot, devout and "
        "severe. Neatly combed thin grey hair, gaunt clean-shaven face, "
        "strict judging expression, straight-backed. Plain dark suit jacket "
        "over a shirt, no tie, no medals.",
    "elena-voroshilova":
        "A 34-year-old Russian woman, hotel manager on the Black Sea coast, "
        "elegant and status-conscious. Glossy dark hair styled carefully, "
        "immaculate discreet makeup, cool composed confident expression. "
        "Well-cut cream blouse, small tasteful jewellery.",
    "galina-zaytseva":
        "A 78-year-old Russian woman, retired mathematics teacher, widow. "
        "White hair gathered at the back, glasses, small precise face, "
        "attentive checking expression as if about to ask another question. "
        "Buttoned knitted cardigan.",
    "roman-savelyev":
        "A 40-year-old Russian man, former debt collector now a service "
        "manager at a car workshop. Shaved head or very short hair, heavy "
        "neck, hard cynical face, faint challenging smirk. Plain dark "
        "sweatshirt.",
    "grigory-logvinov":
        "A 46-year-old Russian man, investigative journalist. Dark hair worn "
        "a little long and untidy, thin sharp face, stubble, glasses, alert "
        "sceptical expression of someone always looking for the catch. "
        "Rumpled dark shirt.",
    "maria-slavnova":
        "A 35-year-old Russian woman, salon worker who grew up wealthy and "
        "keeps up appearances. Long styled light-brown hair, careful makeup, "
        "polished look that is slightly too effortful, fragile guarded "
        "expression. Neat blouse, imitation designer earrings.",
}


def сжать(путь: str) -> str:
    """Приводит оригинал 1024 к webp 384 — в этом виде картинка едет в репозиторий."""
    try:
        from PIL import Image
    except ImportError:
        print("  Pillow не установлен: pip install pillow", file=sys.stderr)
        return путь
    цель = os.path.splitext(путь)[0] + ".webp"
    with Image.open(путь) as im:
        im.convert("RGB").resize((СТОРОНА, СТОРОНА), Image.LANCZOS).save(
            цель, "WEBP", quality=82, method=6
        )
    return цель


def main() -> None:
    s = get_settings()
    os.makedirs(ВЫХОД, exist_ok=True)
    только = [x for x in os.environ.get("ТОЛЬКО", "").split(",") if x]
    жать = bool(os.environ.get("ЖАТЬ"))
    заголовки = {
        "Authorization": f"Bearer {s.llm_api_key}",
        "Content-Type": "application/json",
    }
    итого = 0.0

    with httpx.Client(timeout=180) as client:
        for слаг, описание in ЛЮДИ.items():
            if только and слаг not in только:
                continue
            тело = {
                "model": МОДЕЛЬ,
                "modalities": ["image", "text"],
                # Просим вернуть стоимость вызова: прайс не знает, сколько
                # токенов весит картинка, а этот ответ знает
                "usage": {"include": True},
                "messages": [{"role": "user", "content": f"{описание}\n\n{СТИЛЬ}"}],
            }
            r = client.post(f"{s.llm_base_url}/chat/completions",
                            headers=заголовки, json=тело)
            if r.status_code != 200:
                print(f"  {слаг}: HTTP {r.status_code} {r.text[:200]}",
                      file=sys.stderr, flush=True)
                continue
            ответ = r.json()
            итого += float((ответ.get("usage") or {}).get("cost") or 0)
            msg = (ответ.get("choices") or [{}])[0].get("message") or {}
            картинки = msg.get("images") or []
            if not картинки:
                print(f"  {слаг}: картинки нет, ответ: "
                      f"{json.dumps(msg, ensure_ascii=False)[:200]}",
                      file=sys.stderr, flush=True)
                continue
            url = картинки[0].get("image_url", {}).get("url", "")
            m = re.match(r"data:image/(\w+);base64,(.+)", url, re.S)
            if not m:
                print(f"  {слаг}: не data-URI: {url[:80]}", file=sys.stderr)
                continue
            путь = os.path.join(ВЫХОД, f"{слаг}.{m.group(1)}")
            with open(путь, "wb") as f:
                f.write(base64.b64decode(m.group(2)))
            if жать:
                путь = сжать(путь)
            print(f"  {слаг}: {os.path.getsize(путь) // 1024} КБ "
                  f"→ {os.path.basename(путь)}", file=sys.stderr, flush=True)

    print(f"\nПотрачено: ${итого:.4f}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
