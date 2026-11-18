from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Bandung Transit Router API"
    DATABASE_URL: str
    MJT_ROUTES_URL: str = "https://mjt.trans.my.id/pis/ajax/json_getRoutes"
    MJT_BUSES_URL: str = "https://mjt.trans.my.id/pis/ajax/json_getInitialBuses"
    MJT_SOCKET_URL: str = "https://stream.nginovasi.id:5050"
    BANDUNG_CHANNEL: str = "BTS-63"

    # Production deployment settings
    ALLOWED_ORIGINS: str = ""
    ALLOWED_ORIGIN_REGEX: str = (
        r"^https?://(localhost|127\.0\.0\.1|(\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9-]+\.local)(:\d+)?$"
        r"|^https://[a-zA-Z0-9-]+\.(vercel\.app|pages\.dev|netlify\.app)$"
    )
    AUTO_SEED_ON_EMPTY: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def normalized_database_url(self) -> str:
        url = self.DATABASE_URL.strip()
        # Normalize legacy postgres:// scheme used by some managed cloud dashboards
        if url.startswith("postgres://"):
            return "postgresql://" + url[len("postgres://") :]
        return url

    @property
    def cors_origins(self) -> list[str]:
        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "https://localhost:5173",
            "https://127.0.0.1:5173",
        ]
        if self.ALLOWED_ORIGINS:
            for item in self.ALLOWED_ORIGINS.split(","):
                cleaned = item.strip().rstrip("/")
                if cleaned and cleaned not in origins:
                    origins.append(cleaned)
        return origins


settings = Settings()
