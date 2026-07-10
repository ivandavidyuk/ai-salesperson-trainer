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
    llm_model: str = "openai/gpt-4o-mini"

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
