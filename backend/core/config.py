"""Настройки сервиса, читаются из переменных окружения (.env).

Используется pydantic-settings: имена полей сопоставляются с переменными
окружения без учёта регистра (например, YANDEX_API_KEY -> yandex_api_key).
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

    # Yandex Cloud
    yandex_api_key: str = ""
    yandex_folder_id: str = ""
    yandex_gpt_model: str = "yandexgpt-lite"

    # Инфраструктура (те же значения, что и в Next.js приложении)
    database_url: str = ""
    redis_url: str = ""
    jwt_secret: str = ""

    @property
    def gpt_model_uri(self) -> str:
        """URI модели для YandexGPT в формате gpt://<folder>/<model>/latest."""
        return f"gpt://{self.yandex_folder_id}/{self.yandex_gpt_model}/latest"

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
