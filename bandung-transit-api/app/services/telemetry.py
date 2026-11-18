import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import socketio
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.db.session import sessionLocal
from app.models.transit import Corridor, LiveBus
from app.services.telemetry_hub import telemetry_hub, STALE_BUS_SECONDS

logger = logging.getLogger("bandung-telemetry")

DB_FLUSH_INTERVAL_SEC = 1.5


def load_route_lookup() -> tuple[dict[tuple[str, str] | str, int], dict[int, dict[str, Any]]]:
    """
    Maps (corridor_code, toward) / external_id -> internal PostGIS corridor.id,
    plus corridor_id -> {code, color, toward} for instant zero-DB WebSocket broadcasts.
    """
    with sessionLocal() as db:
        rows = db.query(
            Corridor.id, Corridor.code, Corridor.toward, Corridor.external_id, Corridor.color
        ).all()
        lookup: dict[tuple[str, str] | str, int] = {}
        meta: dict[int, dict[str, Any]] = {}
        for cid, code, toward, ext_id, color in rows:
            tw = (toward or "").strip().lower()
            lookup[(str(code).upper(), tw)] = cid
            lookup[str(ext_id)] = cid
            meta[cid] = {
                "corridor_code": code,
                "color": color or "#2563eb",
                "toward": toward,
            }
        return lookup, meta


def hydrate_hub_from_db() -> int:
    """Loads recent active buses (last 10 min) from PostgreSQL into the in-memory hub on startup."""
    with sessionLocal() as db:
        rows = db.execute(text("""
            SELECT
                b.bus_id, b.bus_name, b.plate_number, b.speed_kmh, b.bearing,
                EXTRACT(EPOCH FROM b.updated_at) AS updated_epoch,
                c.code AS corridor_code, c.color AS corridor_color, c.toward,
                ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat
            FROM live_buses b
            LEFT JOIN corridors c ON b.corridor_id = c.id
            WHERE b.updated_at >= NOW() - INTERVAL '10 minutes';
        """)).fetchall()

    count = 0
    for r in rows:
        feat = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(r.lng), float(r.lat)],
            },
            "properties": {
                "bus_id": r.bus_id,
                "bus_name": r.bus_name,
                "plate_number": r.plate_number,
                "speed_kmh": float(r.speed_kmh or 0.0),
                "bearing": float(r.bearing or 0.0),
                "corridor_code": r.corridor_code,
                "color": r.corridor_color or "#2563eb",
                "toward": r.toward,
            },
        }
        telemetry_hub.update_bus_features([feat], updated_ts=float(r.updated_epoch or time.time()))
        count += 1
    return count


def parse_bus_records(
    records: list[dict],
    route_map: dict,
    corridor_meta: dict[int, dict[str, Any]],
) -> tuple[list[dict], list[dict]]:
    """
    Parses raw MJT Socket.IO / REST bus records into:
      1. DB upsert dicts (for PostgreSQL persistence)
      2. Enriched GeoJSON Features (for immediate in-memory WebSocket broadcast)
    """
    db_rows: list[dict] = []
    geo_features: list[dict] = []
    now = datetime.now(timezone.utc)

    for bus in records:
        if not isinstance(bus, dict):
            continue
        kor = str(bus.get("kor") or "").upper()
        toward = str(bus.get("toward") or "").strip().lower()
        route_id = str(bus.get("route_id") or "")
        corridor_id = route_map.get((kor, toward)) or route_map.get(route_id)
        lat = bus.get("lat")
        lon = bus.get("lon")
        bus_id = str(bus.get("id") or bus.get("gps_sn") or "")

        if not corridor_id or not bus_id or lat is None or lon is None:
            continue

        try:
            lon_f = float(lon)
            lat_f = float(lat)
        except (TypeError, ValueError):
            continue

        speed_f = float(bus.get("speed") or 0.0)
        bearing_f = float(bus.get("direction") or 0.0)
        bus_name = bus.get("name")
        plate_number = bus.get("nopol")

        db_rows.append({
            "bus_id": bus_id,
            "corridor_id": corridor_id,
            "bus_name": bus_name,
            "plate_number": plate_number,
            "speed_kmh": speed_f,
            "bearing": bearing_f,
            "updated_at": now,
            # GeoJSON / PostGIS strictly requires (longitude, latitude)
            "geom": f"SRID=4326;POINT({lon_f} {lat_f})",
        })

        cmeta = corridor_meta.get(corridor_id, {})
        geo_features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon_f, lat_f],
            },
            "properties": {
                "bus_id": bus_id,
                "bus_name": bus_name,
                "plate_number": plate_number,
                "speed_kmh": speed_f,
                "bearing": bearing_f,
                "corridor_code": cmeta.get("corridor_code") or kor,
                "color": cmeta.get("color") or "#2563eb",
                "toward": cmeta.get("toward") or bus.get("toward"),
            },
        })

    return db_rows, geo_features


def flush_db_rows_sync(rows: list[dict]) -> int:
    """Batch-upserts buffered bus rows into PostgreSQL (run in worker thread)."""
    if not rows:
        return 0
    with sessionLocal() as db:
        stmt = insert(LiveBus).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["bus_id"],
            set_={
                "corridor_id": stmt.excluded.corridor_id,
                "bus_name": stmt.excluded.bus_name,
                "plate_number": stmt.excluded.plate_number,
                "speed_kmh": stmt.excluded.speed_kmh,
                "bearing": stmt.excluded.bearing,
                "updated_at": stmt.excluded.updated_at,
                "geom": stmt.excluded.geom,
            },
        )
        db.execute(stmt)
        db.commit()
    return len(rows)


async def fetch_initial_buses(
    route_map: dict,
    corridor_meta: dict[int, dict[str, Any]],
) -> None:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=20.0) as client:
        page_resp = await client.get("https://mjt.trans.my.id/pis")
        page_resp.raise_for_status()

        match = re.search(r"pisNonce:\s*'([^']+)'", page_resp.text)
        ajax_headers = {
            "Referer": str(page_resp.url),
            "X-Requested-With": "XMLHttpRequest",
        }
        if match:
            ajax_headers["X-PIS-Nonce"] = match.group(1)

        resp = await client.get(settings.MJT_BUSES_URL, headers=ajax_headers)
        resp.raise_for_status()
        buses = resp.json().get("data", [])
        db_rows, geo_features = parse_bus_records(buses, route_map, corridor_meta)
        if geo_features:
            telemetry_hub.update_bus_features(geo_features)
            await telemetry_hub.broadcast_bus_delta(geo_features)
        if db_rows:
            await asyncio.to_thread(flush_db_rows_sync, db_rows)
        logger.info(f"Seeded {len(geo_features)} active Bandung buses from initial snapshot.")


async def run_telemetry_worker() -> None:
    route_map, corridor_meta = load_route_lookup()
    if not route_map:
        logger.warning("No corridors found in DB. Run seeder.py before starting telemetry.")
        return

    try:
        hydrated = await asyncio.to_thread(hydrate_hub_from_db)
        logger.info(f"Hydrated {hydrated} active buses into live telemetry hub from DB.")
    except Exception as exc:
        logger.error(f"DB hydration failed: {exc}")

    try:
        await fetch_initial_buses(route_map, corridor_meta)
    except Exception as exc:
        logger.error(f"Initial bus fetch failed: {exc}")

    # Non-blocking write buffer: bus_id -> latest DB upsert row
    pending_db_rows: dict[str, dict] = {}

    async def db_flusher_loop() -> None:
        while True:
            try:
                await asyncio.sleep(DB_FLUSH_INTERVAL_SEC)
                if pending_db_rows:
                    batch = list(pending_db_rows.values())
                    pending_db_rows.clear()
                    await asyncio.to_thread(flush_db_rows_sync, batch)
            except asyncio.CancelledError:
                if pending_db_rows:
                    batch = list(pending_db_rows.values())
                    pending_db_rows.clear()
                    await asyncio.to_thread(flush_db_rows_sync, batch)
                break
            except Exception as exc:
                logger.error(f"DB batch flush error: {exc}")

    flusher_task = asyncio.create_task(db_flusher_loop())

    sio = socketio.AsyncClient(reconnection=True, reconnection_delay=3)

    @sio.event
    async def connect():
        logger.info(f"Connected to MJT Socket.IO stream ({settings.BANDUNG_CHANNEL}).")
        await sio.emit(settings.BANDUNG_CHANNEL)

    async def on_bandung_telemetry(payload):
        buses = payload if isinstance(payload, list) else [payload]
        db_rows, geo_features = parse_bus_records(buses, route_map, corridor_meta)
        if geo_features:
            # 1. Update in-memory state & broadcast immediately to browsers (<5ms latency!)
            telemetry_hub.update_bus_features(geo_features)
            await telemetry_hub.broadcast_bus_delta(geo_features)
        # 2. Buffer DB persistence for background thread batch flush
        for row in db_rows:
            pending_db_rows[row["bus_id"]] = row

    sio.on(settings.BANDUNG_CHANNEL, on_bandung_telemetry)

    socket_headers = {
        "Origin": "https://mjt.trans.my.id",
        "Referer": "https://mjt.trans.my.id/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    try:
        while True:
            try:
                await sio.connect(
                    settings.MJT_SOCKET_URL,
                    transports=["websocket"],
                    headers=socket_headers,
                )
                await sio.wait()
            except asyncio.CancelledError:
                await sio.disconnect()
                break
            except Exception as exc:
                logger.error(f"Socket.IO error: {exc}. Retrying in 5s...")
                await asyncio.sleep(5)
    finally:
        flusher_task.cancel()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_telemetry_worker())
