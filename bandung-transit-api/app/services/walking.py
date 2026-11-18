import logging
import math
from typing import Any
import httpx
import polyline

from app.services.station_access import get_station_entrances

logger = logging.getLogger(__name__)

# In-memory cache for raw pedestrian street routes: (lng1, lat1, lng2, lat2) -> result
_WALKING_CACHE: dict[tuple[float, float, float, float], dict[str, Any]] = {}
MAX_CACHE_SIZE = 2000

WALK_SPEED_MPS = 1.25  # ~4.5 km/h pedestrian pace
VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"
OSRM_FOOT_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"


def haversine_distance_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Calculates great-circle distance between two spatial points in meters."""
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def _query_valhalla_pedestrian(
    from_lng: float,
    from_lat: float,
    to_lng: float,
    to_lat: float,
    timeout_sec: float = 5.0,
) -> dict[str, Any] | None:
    """
    Queries FOSSGIS Valhalla Pedestrian router with alternates enabled and picks
    the shortest genuine pedestrian route (respects alleys, footways, sidewalks, bridges).
    """
    payload = {
        "locations": [
            {"lon": from_lng, "lat": from_lat},
            {"lon": to_lng, "lat": to_lat},
        ],
        "costing": "pedestrian",
        "costing_options": {
            "pedestrian": {
                "walking_speed": 4.5,
                "use_ferry": 0.0,
                "walkway_factor": 0.9,
                "alley_factor": 1.0,
                "driveway_factor": 1.0,
            }
        },
        "alternates": 2,
        "directions_options": {"units": "kilometers"},
    }
    try:
        with httpx.Client(
            timeout=timeout_sec,
            headers={"User-Agent": "BandungTransit/1.1 (PedestrianRouter)"},
        ) as client:
            resp = client.post(VALHALLA_URL, json=payload)
            if resp.status_code != 200:
                return None
            data = resp.json()
            candidates = []
            if "trip" in data and data["trip"].get("legs"):
                candidates.append(data["trip"])
            for alt in data.get("alternates", []):
                if "trip" in alt and alt["trip"].get("legs"):
                    candidates.append(alt["trip"])

            if not candidates:
                return None

            best_trip = min(
                candidates,
                key=lambda t: float(t["legs"][0]["summary"].get("length", 1e9)),
            )
            leg = best_trip["legs"][0]
            dist_m = float(leg["summary"]["length"]) * 1000.0
            decoded = polyline.decode(leg["shape"], 6)
            coords = [[round(lon, 6), round(lat, 6)] for lat, lon in decoded]
            if not coords:
                return None

            return {
                "coords": coords,
                "distance_meters": dist_m,
                "engine": "valhalla",
            }
    except Exception as exc:
        logger.debug("Valhalla pedestrian error: %s", exc)
        return None


def _query_osrm_foot(
    from_lng: float,
    from_lat: float,
    to_lng: float,
    to_lat: float,
    timeout_sec: float = 5.0,
) -> dict[str, Any] | None:
    """
    Queries FOSSGIS OSRM Foot (genuine foot.lua pedestrian profile) with alternatives=true
    and picks the shortest walking route.
    """
    url = (
        f"{OSRM_FOOT_BASE}/{from_lng},{from_lat};{to_lng},{to_lat}"
        f"?overview=full&geometries=geojson&alternatives=true"
    )
    try:
        with httpx.Client(
            timeout=timeout_sec,
            headers={"User-Agent": "BandungTransit/1.1 (PedestrianRouter)"},
        ) as client:
            resp = client.get(url)
            if resp.status_code != 200:
                return None
            data = resp.json()
            routes = data.get("routes")
            if not routes:
                return None
            best = min(routes, key=lambda r: float(r.get("distance", 1e9)))
            coords = list(best.get("geometry", {}).get("coordinates", []))
            if not coords:
                return None
            return {
                "coords": coords,
                "distance_meters": float(best.get("distance", 0.0)),
                "engine": "osrm-foot",
            }
    except Exception as exc:
        logger.debug("OSRM foot error: %s", exc)
        return None


def _build_route_result(
    from_lng: float,
    from_lat: float,
    to_lng: float,
    to_lat: float,
    coords: list[list[float]],
    dist_m: float,
) -> dict[str, Any]:
    """Anchors endpoints cleanly and computes consistent walking duration."""
    anchored = list(coords)
    # Add short connector from exact pin to street snap point if > 2m away
    start_gap = haversine_distance_meters(from_lng, from_lat, anchored[0][0], anchored[0][1])
    if start_gap > 2.0:
        anchored.insert(0, [round(from_lng, 6), round(from_lat, 6)])
        dist_m += start_gap

    end_gap = haversine_distance_meters(anchored[-1][0], anchored[-1][1], to_lng, to_lat)
    if end_gap > 2.0:
        anchored.append([round(to_lng, 6), round(to_lat, 6)])
        dist_m += end_gap

    dur_s = max(15, int(round(dist_m / WALK_SPEED_MPS)))
    return {
        "geometry": {
            "type": "LineString",
            "coordinates": anchored,
        },
        "distance_meters": round(dist_m, 1),
        "duration_seconds": dur_s,
    }


def get_walking_route(
    from_lng: float,
    from_lat: float,
    to_lng: float,
    to_lat: float,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    """
    Fetches the shortest real pedestrian street-network route between two coordinates.
    Uses Valhalla Pedestrian as primary engine and FOSSGIS OSRM-Foot as fallback / detour
    cross-check so broken graph islands or unnecessary detours are avoided.
    Never falls back to car-driving OSRM endpoints.
    """
    cache_key = (
        round(from_lng, 5),
        round(from_lat, 5),
        round(to_lng, 5),
        round(to_lat, 5),
    )
    if cache_key in _WALKING_CACHE:
        return _WALKING_CACHE[cache_key]

    straight_dist = haversine_distance_meters(from_lng, from_lat, to_lng, to_lat)

    # If within 15 meters, straight line is sufficient
    if straight_dist < 15.0:
        res = {
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(from_lng, 6), round(from_lat, 6)], [round(to_lng, 6), round(to_lat, 6)]],
            },
            "distance_meters": round(straight_dist, 1),
            "duration_seconds": max(10, int(round(straight_dist / WALK_SPEED_MPS))),
        }
        _WALKING_CACHE[cache_key] = res
        return res

    # 1. Primary: Valhalla Pedestrian (fresh OSM pedestrian graph, residential alleys & footpaths)
    val_res = _query_valhalla_pedestrian(from_lng, from_lat, to_lng, to_lat, timeout_sec=timeout_sec)

    # 2. Secondary / Detour cross-check: FOSSGIS OSRM Foot
    # Query OSRM-foot if Valhalla failed OR if Valhalla's route has a notable detour (> 1.75x straight line)
    chosen = val_res
    needs_crosscheck = (
        val_res is None
        or (val_res["distance_meters"] > max(200.0, straight_dist * 1.75))
    )
    if needs_crosscheck:
        osrm_res = _query_osrm_foot(from_lng, from_lat, to_lng, to_lat, timeout_sec=timeout_sec)
        if osrm_res is not None:
            if chosen is None or osrm_res["distance_meters"] < chosen["distance_meters"]:
                chosen = osrm_res

    if chosen is not None:
        # Guard against pathological disconnected-island detours (e.g. > 5x straight distance and > 1.5km)
        if chosen["distance_meters"] <= max(1500.0, straight_dist * 5.0):
            res = _build_route_result(
                from_lng, from_lat, to_lng, to_lat,
                chosen["coords"], chosen["distance_meters"],
            )
            if len(_WALKING_CACHE) >= MAX_CACHE_SIZE:
                _WALKING_CACHE.clear()
            _WALKING_CACHE[cache_key] = res
            return res

    # Graceful fallback to geodesic straight line if both pedestrian APIs fail
    fallback_res = {
        "geometry": {
            "type": "LineString",
            "coordinates": [[round(from_lng, 6), round(from_lat, 6)], [round(to_lng, 6), round(to_lat, 6)]],
        },
        "distance_meters": round(straight_dist, 1),
        "duration_seconds": max(20, int(round(straight_dist / WALK_SPEED_MPS))),
    }
    _WALKING_CACHE[cache_key] = fallback_res
    return fallback_res


def get_walking_route_for_stop(
    from_lng: float,
    from_lat: float,
    to_lng: float,
    to_lat: float,
    from_stop_name: str | None = None,
    to_stop_name: str | None = None,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    """
    Entrance-aware pedestrian router for transit stops & railway stations.
    If the origin or destination is a railway station, routes strictly via its verified
    active pedestrian entrance(s) instead of snapping directly to railway track centerlines
    (preventing wrong-side detours such as closed/fenced sides of stations).
    """
    from_entrances = get_station_entrances(from_stop_name)
    to_entrances = get_station_entrances(to_stop_name)

    # Regular bus shelter <-> address or shelter <-> shelter
    if not from_entrances and not to_entrances:
        return get_walking_route(from_lng, from_lat, to_lng, to_lat, timeout_sec=timeout_sec)

    straight_dist = haversine_distance_meters(from_lng, from_lat, to_lng, to_lat)
    # If user is already right at the station platform/building (< 65m), direct short walk
    if straight_dist < 65.0:
        return {
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(from_lng, 6), round(from_lat, 6)], [round(to_lng, 6), round(to_lat, 6)]],
            },
            "distance_meters": round(straight_dist, 1),
            "duration_seconds": max(15, int(round(straight_dist / WALK_SPEED_MPS))),
            "entrance_label": None,
        }

    # Build candidate (start_ent, end_ent) pairs
    start_candidates: list[dict[str, Any] | None] = from_entrances if from_entrances else [None]
    end_candidates: list[dict[str, Any] | None] = to_entrances if to_entrances else [None]

    best_route: dict[str, Any] | None = None

    for s_ent in start_candidates:
        for e_ent in end_candidates:
            # Street endpoints
            s_lng, s_lat = (s_ent["gate"][0], s_ent["gate"][1]) if s_ent else (from_lng, from_lat)
            e_lng, e_lat = (e_ent["gate"][0], e_ent["gate"][1]) if e_ent else (to_lng, to_lat)

            # Check if user is already right at the station gate (< 25m)
            street_dist = haversine_distance_meters(s_lng, s_lat, e_lng, e_lat)
            if street_dist < 25.0:
                street_coords = [[round(s_lng, 6), round(s_lat, 6)], [round(e_lng, 6), round(e_lat, 6)]]
                street_walk_m = street_dist
            else:
                street_res = get_walking_route(s_lng, s_lat, e_lng, e_lat, timeout_sec=timeout_sec)
                street_coords = list(street_res["geometry"]["coordinates"])
                street_walk_m = float(street_res["distance_meters"])

            full_coords: list[list[float]] = []
            extra_m = 0.0

            # Prepend station exit connector: platform -> hall -> gate
            if s_ent:
                p_start = [round(from_lng, 6), round(from_lat, 6)]
                hall = s_ent["hall"]
                gate = s_ent["gate"]
                full_coords.append(p_start)
                if haversine_distance_meters(p_start[0], p_start[1], hall[0], hall[1]) > 5.0:
                    full_coords.append(hall)
                    extra_m += haversine_distance_meters(p_start[0], p_start[1], hall[0], hall[1])
                    extra_m += haversine_distance_meters(hall[0], hall[1], gate[0], gate[1])
                else:
                    extra_m += haversine_distance_meters(p_start[0], p_start[1], gate[0], gate[1])
                full_coords.extend(street_coords)
            else:
                full_coords.extend(street_coords)

            # Append station entry connector: gate -> hall -> platform
            if e_ent:
                gate = e_ent["gate"]
                hall = e_ent["hall"]
                p_end = [round(to_lng, 6), round(to_lat, 6)]
                if haversine_distance_meters(gate[0], gate[1], hall[0], hall[1]) > 5.0:
                    full_coords.append(hall)
                    extra_m += haversine_distance_meters(gate[0], gate[1], hall[0], hall[1])
                    extra_m += haversine_distance_meters(hall[0], hall[1], p_end[0], p_end[1])
                else:
                    extra_m += haversine_distance_meters(gate[0], gate[1], p_end[0], p_end[1])
                full_coords.append(p_end)

            total_m = round(street_walk_m + extra_m, 1)
            total_s = max(20, int(round(total_m / WALK_SPEED_MPS)))
            entrance_label = e_ent["label"] if e_ent else (s_ent["label"] if s_ent else None)

            candidate = {
                "geometry": {
                    "type": "LineString",
                    "coordinates": full_coords,
                },
                "distance_meters": total_m,
                "duration_seconds": total_s,
                "entrance_label": entrance_label,
            }
            if best_route is None or candidate["distance_meters"] < best_route["distance_meters"]:
                best_route = candidate

    assert best_route is not None
    return best_route
