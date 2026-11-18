import json
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.train_telemetry import get_active_trains, get_station_train_schedule
from app.services.telemetry_hub import telemetry_hub

router = APIRouter(prefix="/api/transit", tags=["Transit"])


@router.websocket("/ws/live")
async def live_telemetry_ws(websocket: WebSocket):
    """
    Real-time WebSocket stream pushing instant MJT bus GPS deltas (<50ms latency)
    and 1-second GAPEKA commuter train ticks to the frontend map for 60 FPS animation.
    """
    await telemetry_hub.connect(websocket)
    try:
        while True:
            # Keep connection alive & respond to optional client pings
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        await telemetry_hub.disconnect(websocket)
    except Exception:
        await telemetry_hub.disconnect(websocket)


@router.get("/corridors")
def list_corridors(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT id, external_id, code, name, toward, color, ST_AsGeoJSON(geom) AS geo
        FROM corridors
        ORDER BY code, id;
    """)).fetchall()

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": json.loads(r.geo),
                "properties": {
                    "id": r.id,
                    "code": r.code,
                    "name": r.name,
                    "toward": r.toward,
                    "color": r.color,
                },
            }
            for r in rows
        ],
    }


@router.get("/buses")
def list_live_buses(db: Session = Depends(get_db)):
    cached = telemetry_hub.get_active_bus_features()
    if cached:
        return {
            "type": "FeatureCollection",
            "features": cached,
        }

    rows = db.execute(text("""
        SELECT
            b.bus_id, b.bus_name, b.plate_number, b.speed_kmh, b.bearing,
            c.code AS corridor_code, c.color AS corridor_color, c.toward,
            ST_AsGeoJSON(b.geom) AS geo
        FROM live_buses b
        LEFT JOIN corridors c ON b.corridor_id = c.id
        WHERE b.updated_at >= NOW() - INTERVAL '10 minutes';
    """)).fetchall()

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": json.loads(r.geo),
                "properties": {
                    "bus_id": r.bus_id,
                    "bus_name": r.bus_name,
                    "plate_number": r.plate_number,
                    "speed_kmh": r.speed_kmh,
                    "bearing": r.bearing,
                    "corridor_code": r.corridor_code,
                    "color": r.corridor_color or "#2563eb",
                    "toward": r.toward,
                },
            }
            for r in rows
        ],
    }


@router.get("/trains")
def list_live_trains():
    """Returns real-time positions & station boarding/dwell status of Commuter Line trains."""
    return {
        "type": "FeatureCollection",
        "features": telemetry_hub.get_active_train_features(),
    }


@router.get("/trains/schedule")
def get_train_schedule(
    station: str,
    toward: str = "Padalarang",
    alight_station: str | None = None,
    limit: int = 4,
):
    """Returns real-time upcoming GAPEKA departures from a Commuter Line station."""
    departures = get_station_train_schedule(
        station_name=station,
        corridor_toward=toward,
        alight_station_name=alight_station,
        limit=max(1, min(10, limit)),
    )
    return {
        "station": station,
        "toward": toward,
        "departures": [
            {k: v for k, v in dep.items() if k != "approach_geometry"}
            for dep in departures
        ],
    }


@router.get("/stops")
def list_stops(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT
            s.id, s.name, s.category, s.sequence,
            c.id AS corridor_id, c.code AS corridor_code, c.name AS corridor_name, c.color AS corridor_color,
            ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat
        FROM stops s
        JOIN corridors c ON s.corridor_id = c.id
        ORDER BY s.name, s.sequence;
    """)).fetchall()

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(r.lng), float(r.lat)],
                },
                "properties": {
                    "id": r.id,
                    "name": r.name,
                    "category": r.category,
                    "corridor_id": r.corridor_id,
                    "corridor_code": r.corridor_code,
                    "corridor_name": r.corridor_name,
                    "color": r.corridor_color or "#2563eb",
                },
            }
            for r in rows
        ],
    }
