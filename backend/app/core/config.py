from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+psycopg://hotel:hotel@localhost:5432/hotel_dashboard"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 720
    storage_dir: str = "storage/uploads"
    retention_years: int = 2

    first_admin_email: str = "admin@hotelgroup.in"
    first_admin_password: str = "admin123"

    # Where the app is served from in production.
    public_base_url: str = "https://hospkpi.ambujaneotia.com"
    host: str = "0.0.0.0"
    port: int = 8016
    # Serve the built frontend from the API process, so one port serves the
    # whole app and there is no cross-origin hop.
    serve_frontend: bool = True

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def storage_path(self) -> Path:
        p = Path(self.storage_dir)
        if not p.is_absolute():
            p = BACKEND_ROOT / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def cors_origin_list(self) -> list[str]:
        """Configured origins, always including the public URL itself."""
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        public = self.public_base_url.rstrip("/")
        if public and public not in origins:
            origins.append(public)
        return origins

    @property
    def frontend_dist(self) -> Path:
        return BACKEND_ROOT.parent / "frontend" / "dist"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
