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
        # Normalize bare postgres:// or postgresql:// URIs (e.g. Supabase) to explicit
        # postgresql+psycopg2:// since SQLAlchemy 2.1 defaults bare postgresql:// to psycopg v3.
        if url.startswith("postgres://"):
            return "postgresql+psycopg2://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            return "postgresql+psycopg2://" + url[len("postgresql://") :]
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

    @property
    def cors_origin_regex(self) -> str | None:
        import re

        patterns: list[str] = []
        if self.ALLOWED_ORIGIN_REGEX:
            patterns.append(self.ALLOWED_ORIGIN_REGEX.strip())

        # Automatically allow any subdomain for custom domains listed in ALLOWED_ORIGINS
        # e.g. if ALLOWED_ORIGINS contains "https://efzi.my.id", automatically allow "*.efzi.my.id"
        if self.ALLOWED_ORIGINS:
            for item in self.ALLOWED_ORIGINS.split(","):
                cleaned = item.strip().rstrip("/")
                if not cleaned:
                    continue
                host = re.sub(r"^https?://", "", cleaned).split(":")[0]
                if host and host not in ("localhost", "127.0.0.1"):
                    escaped_host = re.escape(host)
                    patterns.append(rf"^https?://([a-zA-Z0-9-]+\.)*{escaped_host}(:\d+)?$")
                    # If host has subdomain prefix (e.g. transit.efzi.my.id), also allow sibling subdomains & root
                    parts = host.split(".")
                    if len(parts) >= 3:
                        base = ".".join(parts[-3:] if parts[-2] in ("my", "co", "ac", "go", "sch", "or") else parts[-2:])
                        escaped_base = re.escape(base)
                        patterns.append(rf"^https?://([a-zA-Z0-9-]+\.)*{escaped_base}(:\d+)?$")

        return "|".join(f"({p})" for p in patterns) if patterns else None


settings = Settings()
