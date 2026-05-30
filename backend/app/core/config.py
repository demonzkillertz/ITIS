from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "ITIS Annotation API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://itis:itis@localhost:5432/itis"
    redis_url: str = "redis://localhost:6379/0"
    storage_root: Path = Path("../storage")
    vehicle_model_path: Path = Path("../storage/models/vehicle.pt")
    plate_model_path: Path = Path("../storage/models/plate.pt")
    cors_origins_raw: str = Field(
        "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174,https://annotation.sanjibkasti.com.np",
        alias="CORS_ORIGINS",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
