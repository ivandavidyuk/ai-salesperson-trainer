"""Диагностика задержек пайплайна (в изоляции от голоса).

Измеряет:
  1. Сетевую задержку (TCP-connect) до эндпоинтов Yandex — ловит влияние VPN.
  2. Чистую задержку LLM для разных моделей (lite vs pro) на одном промпте.
  3. Чистую задержку TTS v3 (marina).
"""

import asyncio
import socket
import time

import httpx

from core.config import get_settings
from services import llm

REPEATS = 3

ENDPOINTS = [
    ("LLM ", "llm.api.cloud.yandex.net", 443),
    ("TTS ", "tts.api.cloud.yandex.net", 443),
    ("STT ", "stt.api.cloud.yandex.net", 443),
]

# Короткий представительный диалог (тот же system prompt, что в проде)
USER_TURN = "Здравствуйте, я хочу записаться на проверку зрения."


def tcp_connect_ms(host: str, port: int) -> float:
    """Время установки TCP-соединения (без TLS) — грубая оценка сетевого RTT."""
    t = time.perf_counter()
    s = socket.create_connection((host, port), timeout=10)
    dt = (time.perf_counter() - t) * 1000
    s.close()
    return dt


async def time_llm(model_uri: str) -> float:
    """Один вызов YandexGPT с заданным modelUri, возвращает мс."""
    s = get_settings()
    messages = [
        {"role": "system", "text": llm.SYSTEM_PROMPT},
        {"role": "user", "text": USER_TURN},
    ]
    payload = {
        "modelUri": model_uri,
        "completionOptions": {"stream": False, "temperature": 0.6, "maxTokens": 300},
        "messages": messages,
    }
    headers = {
        "Authorization": f"Api-Key {s.yandex_api_key}",
        "x-folder-id": s.yandex_folder_id,
    }
    t = time.perf_counter()
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(llm.GPT_URL, json=payload, headers=headers)
        r.raise_for_status()
        _ = r.json()["result"]["alternatives"][0]["message"]["text"]
    return (time.perf_counter() - t) * 1000


async def time_tts() -> float:
    """Один вызов TTS v3 (marina), возвращает мс."""
    from services import tts

    t = time.perf_counter()
    audio = await tts.synthesize("Здравствуйте, мне надо подумать, я как-то не уверена.")
    dt = (time.perf_counter() - t) * 1000
    return dt


async def main() -> None:
    s = get_settings()
    folder = s.yandex_folder_id

    print("=== 1. Сеть (TCP-connect, мс) — влияние VPN ===")
    for label, host, port in ENDPOINTS:
        vals = []
        for _ in range(REPEATS):
            try:
                vals.append(tcp_connect_ms(host, port))
            except Exception as e:
                vals.append(float("nan"))
                print(f"  {label} {host}: ошибка {e}")
        avg = sum(v for v in vals if v == v) / max(1, len([v for v in vals if v == v]))
        print(f"  {label} {host:32s} avg={avg:6.0f}  {[round(v) for v in vals]}")

    print("\n=== 2. LLM (мс) — сравнение моделей на одном промпте ===")
    models = {
        f"current ({s.yandex_gpt_model})": s.gpt_model_uri,
        "yandexgpt-lite/latest": f"gpt://{folder}/yandexgpt-lite/latest",
        "yandexgpt/latest (pro)": f"gpt://{folder}/yandexgpt/latest",
    }
    for name, uri in models.items():
        vals = []
        for _ in range(REPEATS):
            try:
                vals.append(await time_llm(uri))
            except Exception as e:
                print(f"  {name:28s} ошибка: {e}")
                vals = []
                break
        if vals:
            print(f"  {name:28s} avg={sum(vals)/len(vals):6.0f}  {[round(v) for v in vals]}")

    print("\n=== 3. TTS v3 marina (мс) ===")
    vals = []
    for _ in range(REPEATS):
        try:
            vals.append(await time_tts())
        except Exception as e:
            print(f"  ошибка: {e}"); break
    if vals:
        print(f"  TTS avg={sum(vals)/len(vals):6.0f}  {[round(v) for v in vals]}")


if __name__ == "__main__":
    asyncio.run(main())
