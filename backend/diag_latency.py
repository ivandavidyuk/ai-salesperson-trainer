"""Диагностика задержек пайплайна (в изоляции от голоса).

Измеряет:
  1. Сетевую задержку (TCP-connect) до эндпоинтов OpenRouter и ElevenLabs.
     ElevenLabs недоступен с RU IP — без VPN коннект не пройдёт.
  2. Чистую задержку LLM (OpenRouter) на одном промпте.
  3. Чистую задержку TTS (ElevenLabs, модель из настроек).
"""

import asyncio
import socket
import time

import httpx

from core.config import get_settings
from services import llm

REPEATS = 3

ENDPOINTS = [
    ("LLM (OpenRouter) ", "openrouter.ai", 443),
    ("STT/TTS (11Labs) ", "api.elevenlabs.io", 443),
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


async def time_llm(model: str) -> float:
    """Один вызов chat/completions с заданной моделью, возвращает мс."""
    s = get_settings()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": llm.SYSTEM_PROMPT},
            {"role": "user", "content": USER_TURN},
        ],
        "temperature": 0.6,
        "max_tokens": 300,
    }
    headers = {"Authorization": f"Bearer {s.llm_api_key}"}
    url = f"{s.llm_base_url}/chat/completions"
    t = time.perf_counter()
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(url, json=payload, headers=headers)
        r.raise_for_status()
        _ = r.json()["choices"][0]["message"]["content"]
    return (time.perf_counter() - t) * 1000


async def time_tts() -> float:
    """Один вызов ElevenLabs TTS (модель из настроек), возвращает мс."""
    from services import tts

    t = time.perf_counter()
    await tts.synthesize("Здравствуйте, мне надо подумать, я как-то не уверена.")
    return (time.perf_counter() - t) * 1000


async def main() -> None:
    s = get_settings()

    print("=== 1. Сеть (TCP-connect, мс) — ElevenLabs требует VPN с RU ===")
    for label, host, port in ENDPOINTS:
        vals = []
        for _ in range(REPEATS):
            try:
                vals.append(tcp_connect_ms(host, port))
            except Exception as e:
                vals.append(float("nan"))
                print(f"  {label} {host}: ошибка {e}")
        ok = [v for v in vals if v == v]
        avg = sum(ok) / max(1, len(ok))
        print(f"  {label} {host:24s} avg={avg:6.0f}  {[round(v) for v in vals]}")

    print("\n=== 2. LLM OpenRouter (мс) ===")
    models = {
        f"current ({s.llm_model})": s.llm_model,
        "openai/gpt-4o-mini": "openai/gpt-4o-mini",
        "google/gemini-2.5-flash": "google/gemini-2.5-flash",
    }
    for name, model in dict.fromkeys(models.items()):
        vals = []
        for _ in range(REPEATS):
            try:
                vals.append(await time_llm(model))
            except Exception as e:
                print(f"  {name:32s} ошибка: {e}")
                vals = []
                break
        if vals:
            print(f"  {name:32s} avg={sum(vals)/len(vals):6.0f}  {[round(v) for v in vals]}")

    print(f"\n=== 3. TTS ElevenLabs ({s.elevenlabs_tts_model}, мс) ===")
    vals = []
    for _ in range(REPEATS):
        try:
            vals.append(await time_tts())
        except Exception as e:
            print(f"  ошибка: {e}")
            break
    if vals:
        print(f"  TTS avg={sum(vals)/len(vals):6.0f}  {[round(v) for v in vals]}")


if __name__ == "__main__":
    asyncio.run(main())
