from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import can_admin, get_current_user
from app.models import AppSetting, User, utcnow

router = APIRouter(tags=["config"])

AZURE_KEY = "azure_work_item_url"
PAT_KEY = "azure_devops_pat"


def _setting(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    return (row.value or "").strip() if row else ""


def _put_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
        row.updated_at = utcnow()


def _resolved_azure_url(db: Session) -> tuple[str, str]:
    """DB override wins; otherwise env. Returns (url, source)."""
    stored = _setting(db, AZURE_KEY)
    if stored:
        return stored, "database"
    env = (settings.azure_work_item_url or "").strip()
    return env, "env" if env else "none"


def resolved_azure_pat(db: Session) -> tuple[str, str]:
    stored = _setting(db, PAT_KEY)
    if stored:
        return stored, "database"
    env = (settings.azure_devops_pat or "").strip()
    return env, "env" if env else "none"


def _public_config(db: Session) -> dict:
    url, source = _resolved_azure_url(db)
    _pat, pat_source = resolved_azure_pat(db)
    return {
        "azure_work_item_url": url,
        "azure_work_item_url_source": source,
        "azure_work_item_url_env": (settings.azure_work_item_url or "").strip(),
        "azure_pat_configured": pat_source != "none",
        "azure_pat_source": pat_source,
    }


@router.get("/config")
def app_config(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _public_config(db)


class ConfigBody(BaseModel):
    azure_work_item_url: str | None = Field(default=None, max_length=500)
    # None leaves the saved PAT alone. Empty string clears the DB override.
    azure_pat: str | None = Field(default=None, max_length=200)


@router.patch("/config")
def update_config(
    body: ConfigBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    can_admin(user)
    from fastapi import HTTPException

    if body.azure_work_item_url is not None:
        value = body.azure_work_item_url.strip()
        if value and "{id}" not in value:
            raise HTTPException(status_code=400, detail="URL must include {id} placeholder, e.g. .../edit/{id}")
        _put_setting(db, AZURE_KEY, value)
    if body.azure_pat is not None:
        _put_setting(db, PAT_KEY, body.azure_pat.strip())
    db.commit()
    return _public_config(db)
