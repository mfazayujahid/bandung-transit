"""
In-memory real-time telemetry hub and WebSocket broadcaster for Bandung Transit.

Receives live GPS packets directly from MJT Socket.IO (zero DB blocking) and
broadcasts immediate GeoJSON deltas to all connected browser WebSockets, while
also pushing 1-second GAPEKA commuter train ticks so the frontend can interpolate
all vehicles smoothly at 60 FPS.
"""

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import WebSocket

from app.services.train_telemetry import get_active_trains

logger = logging.getLogger("bandung-telemetry-hub")

STALE_BUS_SECONDS = 600.0  # Hide buses with no GPS heartbeat in the last 10 minutes


class TelemetryHub:
    def __init__(self) -> None:
        # bus_id -> {"feature": GeoJSON Feature dict, "updated_ts": float}
        self._buses: dict[str, dict[str, Any]] = {}
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    def update_bus_features(self, features: list[dict[str, Any]], updated_ts: float | None = None) -> None:
        """Updates in-memory live bus cache (safe to call from sync or async contexts)."""
        ts = updated_ts if updated_ts is not None else time.time()
        for feat in features:
            bid = str(feat.get("properties", {}).get("bus_id") or "")
            if not bid:
                continue
            self._buses[bid] = {
                "feature": feat,
                "updated_ts": ts,
            }

    def get_active_bus_features(self) -> list[dict[str, Any]]:
        """Returns active (non-stale) bus GeoJSON features from memory."""
        cutoff = time.time() - STALE_BUS_SECONDS
        stale_ids = [bid for bid, item in self._buses.items() if item["updated_ts"] < cutoff]
        for bid in stale_ids:
            self._buses.pop(bid, None)
        return [item["feature"] for item in self._buses.values()]

    @staticmethod
    def get_active_train_features() -> list[dict[str, Any]]:
        """Builds GeoJSON features for live GAPEKA commuter trains."""
        trains = get_active_trains()
        return [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": t["coordinates"],
                },
                "properties": {
                    "train_id": t["train_id"],
                    "train_number": t["train_number"],
                    "corridor_code": t["corridor_code"],
                    "corridor_name": t["corridor_name"],
                    "toward": t["toward"],
                    "origin": t["origin"],
                    "destination": t["destination"],
                    "color": t["color"],
                    "bearing": t["bearing"],
                    "speed_kmh": t["speed_kmh"],
                    "status": t.get("status", "MOVING"),
                    "current_station": t.get("current_station"),
                    "dwell_remaining_sec": t.get("dwell_remaining_sec", 0),
                    "progress_percent": t["progress_percent"],
                    "next_station": t["next_station"],
                    "eta_next_station_minutes": t["eta_next_station_minutes"],
                    "updated_at": t["updated_at"],
                },
            }
            for t in trains
        ]

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
        # Immediately send full active snapshot so vehicles render on frame 1
        snapshot = {
            "type": "snapshot",
            "buses": self.get_active_bus_features(),
            "trains": self.get_active_train_features(),
            "server_ts": time.time(),
        }
        try:
            await ws.send_text(json.dumps(snapshot))
        except Exception:
            await self.disconnect(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    async def broadcast_json(self, payload: dict[str, Any]) -> None:
        if not self._clients:
            return
        msg = json.dumps(payload)
        async with self._lock:
            clients_snapshot = list(self._clients)

        dead: list[WebSocket] = []
        for ws in clients_snapshot:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)

    async def broadcast_bus_delta(self, features: list[dict[str, Any]]) -> None:
        if not features or not self._clients:
            return
        await self.broadcast_json({
            "type": "bus_delta",
            "features": features,
            "server_ts": time.time(),
        })

    async def broadcast_train_tick(self) -> None:
        if not self._clients:
            return
        await self.broadcast_json({
            "type": "train_tick",
            "trains": self.get_active_train_features(),
            "server_ts": time.time(),
        })

    @property
    def client_count(self) -> int:
        return len(self._clients)


# Process-wide singleton hub shared between telemetry worker & WebSocket endpoint
telemetry_hub = TelemetryHub()


async def run_train_broadcaster() -> None:
    """Pushes smooth 1-second GAPEKA commuter train ticks to all connected WebSocket clients."""
    while True:
        try:
            await asyncio.sleep(1.0)
            if telemetry_hub.client_count > 0:
                await telemetry_hub.broadcast_train_tick()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("Train tick broadcast error: %s", exc)
            await asyncio.sleep(1.0)
