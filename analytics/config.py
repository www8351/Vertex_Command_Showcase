from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://vertex:vertex@postgres:5432/vertex_command"
    log_level: str = "info"
    max_trade_rows: int = 100_000

    model_config = {"env_prefix": "ANALYTICS_"}


settings = Settings()
