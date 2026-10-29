from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.database import Base, SessionLocal, engine, ensure_columns
from app.routes import api_router
from app.seed import seed
from app.services.execute import backfill_bugs
from app.services.folders import backfill_folders

import app.models  # noqa: F401  — register tables


def _wait_for_database() -> None:
    for attempt in range(30):
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return
        except OperationalError:
            import time

            time.sleep(1)
    raise RuntimeError("Database did not become ready.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    _wait_for_database()
    Base.metadata.create_all(bind=engine)
    ensure_columns()
    db = SessionLocal()
    try:
        seed(db)
        backfill_folders(db)
        backfill_bugs(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Test Management", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")
app.mount("/uploads", StaticFiles(directory=str(settings.upload_dir)), name="uploads")


@app.get("/api/health")
def health():
    return {"ok": True}
