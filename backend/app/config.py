from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR.parent / ".env"
if not ENV_FILE.exists():
    ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), extra="ignore")

    env: str = "development"
    secret_key: str = "dev-tms-secret-change-me"
    database_url: str = f"sqlite:///{(BASE_DIR / 'tms.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
    access_token_hours: int = 12
    upload_dir: Path = BASE_DIR / "uploads"
    admin_email: str = "admin@local"
    admin_password: str = "admin123"
    # Optional: https://dev.azure.com/{org}/{project}/_workitems/edit/{id}
    azure_work_item_url: str = ""
    # Optional PAT so Bugs can pull Closed/Resolved/Active from Azure Boards.
    azure_devops_pat: str = ""


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
