import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import routing, transit
from app.core.config import settings
from app.db.init_db import init_db, seed_if_empty
from app.services.telemetry import run_telemetry_worker
from app.services.telemetry_hub import run_train_broadcaster

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _bootstrap_seed_if_needed() -> None:
    if not settings.AUTO_SEED_ON_EMPTY:
        return
    try:
        await asyncio.to_thread(seed_if_empty)
    except Exception as exc:
        logger.exception("Background seed task error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_task = asyncio.create_task(_bootstrap_seed_if_needed())
    telemetry_task = asyncio.create_task(run_telemetry_worker())
    train_task = asyncio.create_task(run_train_broadcaster())
    yield
    seed_task.cancel()
    telemetry_task.cancel()
    train_task.cancel()


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "bandung-transit-api"}


app.include_router(transit.router)
app.include_router(routing.router)
