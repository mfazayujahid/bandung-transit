import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import routing, transit
from app.db.init_db import init_db
from app.services.telemetry import run_telemetry_worker
from app.services.telemetry_hub import run_train_broadcaster

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    telemetry_task = asyncio.create_task(run_telemetry_worker())
    train_task = asyncio.create_task(run_train_broadcaster())
    yield
    telemetry_task.cancel()
    train_task.cancel()


app = FastAPI(title="Bandung Transit Router API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    # Allow local network (LAN) IPs & .local mDNS hostnames on any port over HTTP/HTTPS
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|(\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9-]+\.local)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transit.router)
app.include_router(routing.router)