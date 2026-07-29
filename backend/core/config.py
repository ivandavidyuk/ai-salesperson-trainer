"""Настройки сервиса, читаются из переменных окружения (.env).

Используется pydantic-settings: имена полей сопоставляются с переменными
окружения без учёта регистра (например, LLM_API_KEY -> llm_api_key).
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Файл .env берётся из текущей рабочей директории (папка backend)
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # LLM — любой OpenAI-совместимый провайдер (сейчас OpenRouter)
    llm_api_key: str = ""
    llm_base_url: str = "https://openrouter.ai/api/v1"
    # Совпадает с тем, что стоит в проде: раньше умолчание расходилось
    # с реальностью, и локально мы гоняли не ту модель, что живые менеджеры
    llm_model: str = "google/gemini-2.5-flash-lite"

    # Оценщик разговора — отдельная модель от роли. Требования обратные:
    # роли важна задержка (у неё размышление выключено), оценщику —
    # устойчивость суждения, а ждать его никто не ждёт: он вне критического
    # пути. Отдельная переменная позволяет менять его, не трогая пайплайн.
    #
    # ФОНОВЫЙ оценщик — ходит после каждого хода, ~16–20 раз за разговор,
    # ПАРАЛЛЕЛЬНО живому разговору. Отсюда два требования: дёшево и, главное,
    # мимо очереди роли. Пока обе стояли на google/gemini-2.5-flash-lite,
    # половина его запросов получала «429 temporarily rate-limited upstream»,
    # а задержка разговора выросла с 480–1500 мс до 5–7 с на пиках.
    # Вендор поэтому берём другой: лимит у OpenRouter считается по конкретной
    # модели вышестоящего, и соседняя модель того же Google развела бы хуже.
    scorer_model: str = "openai/gpt-4o-mini"

    # ИТОГОВЫЙ оценщик — один вызов, и он происходит ПОСЛЕ конца разговора.
    # Конкурировать с ролью он не может по определению, поэтому запрет
    # на вендора роли сюда не распространяется, а экономить на единственном
    # запросе бессмысленно: его вердикт попадает в базу навсегда.
    #
    # Выбран замером на семи живых расшифровках (27.07.2026, два прогона
    # на каждую). Устойчивость исхода: gemini-3.5-flash-lite 7/7,
    # gpt-4o-mini 7/7, gpt-5.6-luna 6/7, claude-haiku-4.5 4/7. При равной
    # устойчивости gemini быстрее (1.1–1.9 с) и пишет разбор по обязательным
    # условиям пациента, а не общими словами — а judgeNotes нужны нам
    # для сверки вердиктов роли и оценщика.
    final_scorer_model: str = "google/gemini-3.5-flash-lite"
    # Порог допуска к согласию: средняя по первым четырём этапам.
    # Регулятор сложности — ниже ближе к жизни, выше строже к технике
    deal_score_threshold: float = 7.0

    # ElevenLabs — STT (Realtime) и TTS
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    # eleven_flash_v2_5 — минимальная задержка; eleven_v3 — эмоции и audio-теги
    elevenlabs_tts_model: str = "eleven_flash_v2_5"
    elevenlabs_stt_model: str = "scribe_v2_realtime"

    # Barge-in: менеджер может перебить ИИ голосом — воспроизведение
    # обрывается. Рубильник на случай ложных срабатываний от эха на проде.
    barge_in_enabled: bool = True

    # Инфраструктура (те же значения, что и в Next.js приложении)
    database_url: str = ""
    redis_url: str = ""
    jwt_secret: str = ""

    @property
    def asyncpg_dsn(self) -> str:
        """DSN для asyncpg.

        Prisma добавляет в строку параметр ?schema=public, который asyncpg
        не понимает, поэтому отбрасываем query-часть.
        """
        return self.database_url.split("?", 1)[0]


@lru_cache
def get_settings() -> Settings:
    """Возвращает единственный экземпляр настроек (кешируется)."""
    return Settings()
