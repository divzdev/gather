from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# The single .env lives at the repo root so one file configures every app.
REPO_ROOT = Path(__file__).resolve().parents[5]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    env: Literal["local", "test", "staging", "production"] = "local"
    demo_mode: bool = True

    database_url: str = "postgresql+asyncpg://gather:gather@localhost:5441/gather"
    redis_url: str = "redis://localhost:6379/0"

    # Intentional local-only default so the app boots with no credentials.
    # require_production_secrets() refuses to start if this survives to production.
    secret_key: str = "dev-secret-not-for-production-do-not-reuse"  # noqa: S105
    # NoDecode: without it pydantic-settings JSON-decodes list fields inside the
    # env source, before any validator runs, so a plain CSV value raises.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    magic_link_ttl_minutes: int = 30
    speaker_session_ttl_days: int = 7

    mail_transport: Literal["log", "ses"] = "log"
    mail_from: str = "events@example.com"

    anthropic_api_key: str = ""
    ai_model_default: str = "claude-sonnet-5"
    ai_max_tokens: int = 4096

    storage_backend: Literal["local", "s3"] = "local"
    s3_bucket: str = ""
    aws_region: str = "us-east-1"

    api_host: str = "127.0.0.1"
    api_port: int = 8000

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def ai_enabled(self) -> bool:
        """False falls back to the stub adapter rather than failing a request."""
        return bool(self.anthropic_api_key)

    @property
    def seeding_allowed(self) -> bool:
        """Guarded in code, not only in config — a stray SEED_ON_BOOT in production
        must not be able to overwrite a real event."""
        return not (self.is_production and not self.demo_mode)

    def require_production_secrets(self) -> None:
        """Called at startup. Fails loud rather than booting a footgun."""
        if not self.is_production:
            return
        if self.secret_key.startswith("dev-secret"):
            raise RuntimeError("SECRET_KEY is still the development default in production")
        if self.demo_mode:
            raise RuntimeError("DEMO_MODE must be false in production")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
