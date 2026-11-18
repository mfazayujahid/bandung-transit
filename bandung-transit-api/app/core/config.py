from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Bandung Transit Router API"
    DATABASE_URL: str
    MJT_ROUTES_URL: str = "https://mjt.trans.my.id/pis/ajax/json_getRoutes"
    MJT_BUSES_URL: str = "https://mjt.trans.my.id/pis/ajax/json_getInitialBuses"
    MJT_SOCKET_URL: str = "https://stream.nginovasi.id:5050"
    BANDUNG_CHANNEL: str = "BTS-63"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()