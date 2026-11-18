"""
Commuter Line Bandung Raya GAPEKA Timetable & Real-Time Tracking Engine.

Simulates realistic station-to-station train physics and live operational timetables along
the Padalarang - Cicalengka corridor based on PT Kereta Api Indonesia (KAI) GAPEKA:
  - Accurate physical track projection for all 13 stations
  - Real passenger boarding/alighting dwell stops at every station (1.5–3.0 min, 0 km/h)
  - Smooth acceleration/cruising/deceleration speed curve between stations
  - Exact scheduled departure/arrival times (WIB) and upcoming departure boards
  - Exact incoming approach track geometry from approaching train -> boarding station
"""

from datetime import datetime, timezone, timedelta
import math
from typing import Any

from app.services.rail_seeder import TRACK_COORDS, STATIONS_EASTBOUND


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lon2 - lon1)
    y = math.sin(dlam) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    deg = math.degrees(math.atan2(y, x))
    return (deg + 360) % 360


def _build_track_profile(coords: list[list[float]]) -> list[float]:
    cum_dist = [0.0]
    for i in range(len(coords) - 1):
        d = haversine_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
        cum_dist.append(cum_dist[-1] + d)
    return cum_dist


EAST_TRACK: list[list[float]] = TRACK_COORDS
EAST_DIST: list[float] = _build_track_profile(EAST_TRACK)
EAST_TOTAL_M: float = EAST_DIST[-1]

WEST_TRACK: list[list[float]] = list(reversed(TRACK_COORDS))
WEST_DIST: list[float] = _build_track_profile(WEST_TRACK)
WEST_TOTAL_M: float = WEST_DIST[-1]


def _project_point_to_track(lng: float, lat: float, track: list[list[float]], cum_dist: list[float]) -> float:
    """Finds the exact cumulative meter distance along `track` closest to (lng, lat)."""
    best_dist_m = 0.0
    best_err = float("inf")
    for i, pt in enumerate(track):
        err = haversine_m(lng, lat, pt[0], pt[1])
        if err < best_err:
            best_err = err
            best_dist_m = cum_dist[i]
    return best_dist_m


# Realistic GAPEKA station-by-station timetable profile (eastbound Padalarang -> Cicalengka)
# Each station has explicit arrival_min, departure_min (dwell = dep - arr for passenger boarding/alighting).
_EAST_TIMETABLE_DEF = [
    {"name": "Stasiun Padalarang", "code": "PDL", "arr": -2.0, "dep": 0.0},
    {"name": "Stasiun Gadobangkong", "code": "GK", "arr": 5.5, "dep": 7.0},
    {"name": "Stasiun Cimahi", "code": "CMI", "arr": 12.0, "dep": 14.0},
    {"name": "Stasiun Cimindi", "code": "CMD", "arr": 18.0, "dep": 19.5},
    {"name": "Stasiun Ciroyom", "code": "CIR", "arr": 25.0, "dep": 26.5},
    {"name": "Stasiun Bandung", "code": "BD", "arr": 30.0, "dep": 33.0},
    {"name": "Stasiun Cikudapateuh", "code": "CTH", "arr": 37.5, "dep": 39.0},
    {"name": "Stasiun Kiaracondong", "code": "KAC", "arr": 44.0, "dep": 47.0},
    {"name": "Stasiun Gedebage", "code": "GDB", "arr": 55.5, "dep": 57.0},
    {"name": "Stasiun Cimekar", "code": "CMK", "arr": 62.5, "dep": 64.0},
    {"name": "Stasiun Rancaekek", "code": "RCK", "arr": 70.5, "dep": 72.5},
    {"name": "Stasiun Haurpugur", "code": "HRP", "arr": 79.5, "dep": 81.0},
    {"name": "Stasiun Cicalengka", "code": "CCL", "arr": 88.0, "dep": 90.0},
]

_STATION_COORDS_MAP = {st["name"]: [st["lng"], st["lat"]] for st in STATIONS_EASTBOUND}


def _build_direction_stops(direction: str) -> list[dict[str, Any]]:
    track = EAST_TRACK if direction == "EAST" else WEST_TRACK
    cum_dist = EAST_DIST if direction == "EAST" else WEST_DIST
    total_m = EAST_TOTAL_M if direction == "EAST" else WEST_TOTAL_M

    if direction == "EAST":
        raw = _EAST_TIMETABLE_DEF
    else:
        # Mirror segment travel times & preserve realistic dwell times for Westbound (Cicalengka -> Padalarang)
        rev = list(reversed(_EAST_TIMETABLE_DEF))
        raw = []
        cursor = 0.0
        for idx, st in enumerate(rev):
            if idx == 0:
                raw.append({"name": st["name"], "code": st["code"], "arr": -2.0, "dep": 0.0})
                cursor = 0.0
            else:
                # Travel time between prev and current from eastbound definition
                east_idx_prev = len(_EAST_TIMETABLE_DEF) - idx
                east_idx_curr = len(_EAST_TIMETABLE_DEF) - 1 - idx
                seg_travel = _EAST_TIMETABLE_DEF[east_idx_prev]["arr"] - _EAST_TIMETABLE_DEF[east_idx_curr]["dep"]
                arr_t = cursor + max(2.0, seg_travel)
                # Preserve hub dwell time
                orig_dwell = st["dep"] - st["arr"]
                dwell = 2.0 if idx == len(rev) - 1 else max(1.5, orig_dwell)
                dep_t = arr_t + dwell
                raw.append({"name": st["name"], "code": st["code"], "arr": round(arr_t, 2), "dep": round(dep_t, 2)})
                cursor = dep_t

    stops: list[dict[str, Any]] = []
    for st in raw:
        c = _STATION_COORDS_MAP[st["name"]]
        dist_m = _project_point_to_track(c[0], c[1], track, cum_dist)
        stops.append({
            "name": st["name"],
            "code": st["code"],
            "coords": c,
            "dist_m": dist_m,
            "frac": dist_m / total_m if total_m > 0 else 0.0,
            "arr_min": st["arr"],
            "dep_min": st["dep"],
        })
    return stops


EAST_STOPS = _build_direction_stops("EAST")
WEST_STOPS = _build_direction_stops("WEST")
TOTAL_JOURNEY_MINUTES = EAST_STOPS[-1]["dep_min"]  # 90.0 min


def interpolate_track_meters(target_m: float, direction: str = "EAST") -> tuple[list[float], float]:
    """Given meter distance along the corridor, returns exact [lng, lat] and bearing degree."""
    track = EAST_TRACK if direction == "EAST" else WEST_TRACK
    cum_dist = EAST_DIST if direction == "EAST" else WEST_DIST
    total_m = EAST_TOTAL_M if direction == "EAST" else WEST_TOTAL_M

    target_m = max(0.0, min(total_m, target_m))
    idx = 0
    for i in range(len(cum_dist) - 1):
        if cum_dist[i] <= target_m <= cum_dist[i + 1]:
            idx = i
            break
    seg_len = cum_dist[idx + 1] - cum_dist[idx]
    t = (target_m - cum_dist[idx]) / seg_len if seg_len > 0 else 0.0

    p1 = track[idx]
    p2 = track[idx + 1]
    lng = p1[0] + t * (p2[0] - p1[0])
    lat = p1[1] + t * (p2[1] - p1[1])
    bearing = calculate_bearing(p1[0], p1[1], p2[0], p2[1])
    return [round(lng, 6), round(lat, 6)], round(bearing, 1)


def interpolate_track(fraction: float, direction: str = "EAST") -> tuple[list[float], float]:
    total_m = EAST_TOTAL_M if direction == "EAST" else WEST_TOTAL_M
    return interpolate_track_meters(max(0.0, min(1.0, fraction)) * total_m, direction)


def get_track_subline(start_m: float, end_m: float, direction: str = "EAST") -> dict[str, Any]:
    """Returns a GeoJSON LineString slicing the physical railway track from start_m to end_m."""
    track = EAST_TRACK if direction == "EAST" else WEST_TRACK
    cum_dist = EAST_DIST if direction == "EAST" else WEST_DIST
    total_m = EAST_TOTAL_M if direction == "EAST" else WEST_TOTAL_M

    s_m = max(0.0, min(total_m, start_m))
    e_m = max(0.0, min(total_m, end_m))
    if s_m >= e_m:
        p1, _ = interpolate_track_meters(s_m, direction)
        p2, _ = interpolate_track_meters(e_m, direction)
        return {"type": "LineString", "coordinates": [p1, p2]}

    start_pt, _ = interpolate_track_meters(s_m, direction)
    end_pt, _ = interpolate_track_meters(e_m, direction)
    coords = [start_pt]
    for i, d in enumerate(cum_dist):
        if s_m < d < e_m:
            coords.append(track[i])
    coords.append(end_pt)
    return {"type": "LineString", "coordinates": coords}


# GAPEKA Timetable: Departures (hour, minute, KA number)
EASTBOUND_SCHEDULE = [
    (4, 30, "KA 342"), (5, 5, "KA 344"), (5, 40, "KA 346"), (6, 15, "KA 348"),
    (6, 50, "KA 350"), (7, 25, "KA 352"), (8, 0, "KA 354"), (8, 35, "KA 356"),
    (9, 10, "KA 358"), (9, 45, "KA 360"), (10, 20, "KA 362"), (10, 55, "KA 364"),
    (11, 30, "KA 366"), (12, 5, "KA 368"), (12, 40, "KA 370"), (13, 15, "KA 372"),
    (13, 50, "KA 374"), (14, 25, "KA 376"), (15, 0, "KA 378"), (15, 35, "KA 380"),
    (16, 10, "KA 382"), (16, 45, "KA 384"), (17, 20, "KA 386"), (17, 55, "KA 388"),
    (18, 30, "KA 390"), (19, 5, "KA 392"), (19, 40, "KA 394"), (20, 15, "KA 396"),
    (20, 50, "KA 398"), (21, 25, "KA 400"), (22, 0, "KA 402"),
]

WESTBOUND_SCHEDULE = [
    (4, 45, "KA 341"), (5, 20, "KA 343"), (5, 55, "KA 345"), (6, 30, "KA 347"),
    (7, 5, "KA 349"), (7, 40, "KA 351"), (8, 15, "KA 353"), (8, 50, "KA 355"),
    (9, 25, "KA 357"), (10, 0, "KA 359"), (10, 35, "KA 361"), (11, 10, "KA 363"),
    (11, 45, "KA 365"), (12, 20, "KA 367"), (12, 55, "KA 369"), (13, 30, "KA 371"),
    (14, 5, "KA 373"), (14, 40, "KA 375"), (15, 15, "KA 377"), (15, 50, "KA 379"),
    (16, 25, "KA 381"), (17, 0, "KA 383"), (17, 35, "KA 385"), (18, 10, "KA 387"),
    (18, 45, "KA 389"), (19, 20, "KA 391"), (19, 55, "KA 393"), (20, 30, "KA 395"),
    (21, 5, "KA 397"), (21, 40, "KA 399"), (22, 15, "KA 401"),
]


def get_current_time_wib() -> datetime:
    """Returns current Western Indonesia Time (UTC+7)."""
    return datetime.now(timezone.utc) + timedelta(hours=7)


def format_minute_of_day_wib(minute_of_day: float) -> str:
    """Formats minute-of-day float into 'HH:MM WIB'."""
    total_mins = int(round(minute_of_day)) % (24 * 60)
    hh = total_mins // 60
    mm = total_mins % 60
    return f"{hh:02d}:{mm:02d} WIB"


def _smooth_segment_progress(u: float) -> tuple[float, float]:
    """
    Smooth acceleration/cruising/deceleration curve between stations.
    Returns (distance_progress [0..1], speed_multiplier [0..1.15]).
    First 14% smoothly accelerates from 0 -> cruising speed, middle cruises, last 14% smoothly brakes to 0.
    """
    u = max(0.0, min(1.0, u))
    accel_u = 0.14
    decel_u = 0.86
    # Normalized distance integral so s(0)=0 and s(1)=1 cleanly
    # Area of trapezoidal speed profile = 1 - accel_u = 0.86 -> peak multiplier = 1 / 0.86 ≈ 1.163
    peak = 1.0 / (1.0 - accel_u)
    if u < accel_u:
        # Quadratic ramp up: v(u) = peak * (u / accel_u)
        s = 0.5 * peak * (u * u) / accel_u
        v_mult = peak * (u / accel_u)
    elif u <= decel_u:
        s_accel = 0.5 * peak * accel_u
        s = s_accel + peak * (u - accel_u)
        v_mult = peak
    else:
        rem = 1.0 - u
        s = 1.0 - 0.5 * peak * (rem * rem) / accel_u
        v_mult = peak * (rem / accel_u)
    return max(0.0, min(1.0, s)), max(0.0, v_mult)


def _evaluate_train_state(
    elapsed: float,
    direction: str,
    code: str,
    now: datetime,
) -> dict[str, Any]:
    """Computes exact real-time position, speed, boarding/dwell state, and next station."""
    stops = EAST_STOPS if direction == "EAST" else WEST_STOPS
    total_m = EAST_TOTAL_M if direction == "EAST" else WEST_TOTAL_M

    status = "MOVING"
    current_station: str | None = None
    dwell_remaining_sec = 0
    next_st = stops[-1]["name"]
    eta_mins = 0.0
    pos_m = 0.0
    speed_kmh = 0.0

    # 1. Check if train is currently STOPPED at a station platform (boarding / alighting dwell!)
    stopped = False
    for idx, st in enumerate(stops):
        if st["arr_min"] <= elapsed <= st["dep_min"]:
            stopped = True
            status = "BOARDING"
            current_station = st["name"]
            dwell_remaining_sec = max(0, int(round((st["dep_min"] - elapsed) * 60)))
            pos_m = st["dist_m"]
            speed_kmh = 0.0
            if idx < len(stops) - 1:
                next_st = stops[idx + 1]["name"]
                eta_mins = round(stops[idx + 1]["arr_min"] - elapsed, 1)
            else:
                next_st = st["name"]
                eta_mins = 0.0
            break

    # 2. Otherwise train is MOVING between two consecutive stations with realistic acceleration/braking
    if not stopped:
        for idx in range(len(stops) - 1):
            st_a = stops[idx]
            st_b = stops[idx + 1]
            if st_a["dep_min"] < elapsed < st_b["arr_min"]:
                seg_dur_min = max(0.5, st_b["arr_min"] - st_a["dep_min"])
                u = (elapsed - st_a["dep_min"]) / seg_dur_min
                prog, v_mult = _smooth_segment_progress(u)

                seg_dist_m = max(100.0, st_b["dist_m"] - st_a["dist_m"])
                pos_m = st_a["dist_m"] + prog * seg_dist_m
                avg_kmh = (seg_dist_m / 1000.0) / (seg_dur_min / 60.0)
                speed_kmh = round(min(75.0, max(5.0, avg_kmh * v_mult)), 1)
                next_st = st_b["name"]
                eta_mins = round(st_b["arr_min"] - elapsed, 1)
                break

    coords, bearing = interpolate_track_meters(pos_m, direction)
    # Snap directly onto exact station platform coordinate while stopped
    if stopped and current_station and current_station in _STATION_COORDS_MAP:
        coords = _STATION_COORDS_MAP[current_station]

    toward = "Cicalengka" if direction == "EAST" else "Padalarang"
    origin = "Stasiun Padalarang" if direction == "EAST" else "Stasiun Cicalengka"
    destination = "Stasiun Cicalengka" if direction == "EAST" else "Stasiun Padalarang"

    return {
        "train_id": code.replace(" ", "_"),
        "train_number": code,
        "corridor_code": "CLR",
        "corridor_name": "Commuter Line Bandung Raya",
        "toward": toward,
        "origin": origin,
        "destination": destination,
        "color": "#1e3a8a",
        "direction": direction,
        "coordinates": coords,
        "bearing": bearing,
        "speed_kmh": speed_kmh,
        "status": status,
        "current_station": current_station,
        "dwell_remaining_sec": dwell_remaining_sec,
        "dist_m": round(pos_m, 1),
        "progress_percent": round((pos_m / total_m) * 100, 1) if total_m > 0 else 0.0,
        "next_station": next_st,
        "eta_next_station_minutes": max(0.0, eta_mins),
        "updated_at": now.isoformat(),
    }


def get_active_trains(sim_time: datetime | None = None) -> list[dict[str, Any]]:
    """
    Returns all currently operating Commuter Line Bandung Raya trains along the corridor,
    including trains currently stopped at platforms for passenger boarding/alighting.
    """
    now = sim_time or get_current_time_wib()
    minute_of_day = now.hour * 60 + now.minute + (now.second / 60.0)

    active_trains: list[dict[str, Any]] = []

    for h, m, code in EASTBOUND_SCHEDULE:
        dep_min = h * 60 + m
        if (dep_min - 2.0) <= minute_of_day <= (dep_min + TOTAL_JOURNEY_MINUTES):
            active_trains.append(_evaluate_train_state(minute_of_day - dep_min, "EAST", code, now))

    for h, m, code in WESTBOUND_SCHEDULE:
        dep_min = h * 60 + m
        if (dep_min - 2.0) <= minute_of_day <= (dep_min + TOTAL_JOURNEY_MINUTES):
            active_trains.append(_evaluate_train_state(minute_of_day - dep_min, "WEST", code, now))

    # Late-night standby simulation so the map remains demonstrable outside 04:30-23:45 WIB
    if not active_trains:
        cycle_min = (now.minute + now.second / 60.0) % 45.0
        active_trains.append(_evaluate_train_state(cycle_min * 1.9, "EAST", "KA 352", now))
        active_trains.append(_evaluate_train_state(((cycle_min + 22.5) % 45.0) * 1.9, "WEST", "KA 355", now))

    return active_trains


def _find_station_entry(stop_name: str, direction: str) -> dict[str, Any]:
    stops = EAST_STOPS if direction == "EAST" else WEST_STOPS
    target = stop_name.lower().strip()
    for st in stops:
        if st["name"].lower() in target or target in st["name"].lower():
            return st
    return stops[0]


def get_station_train_schedule(
    station_name: str,
    corridor_toward: str,
    alight_station_name: str | None = None,
    min_lead_seconds: int = 0,
    limit: int = 4,
    sim_time: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Returns the next `limit` scheduled Commuter Line departures from `station_name` in
    the given direction, with exact WIB departure/arrival times, live train status,
    approach distance, and approach track GeoJSON geometry.
    """
    now = sim_time or get_current_time_wib()
    minute_of_day = now.hour * 60 + now.minute + (now.second / 60.0)
    min_catch_min = minute_of_day + (min_lead_seconds / 60.0)

    direction = "EAST" if "cicalengka" in corridor_toward.lower() else "WEST"
    schedule = EASTBOUND_SCHEDULE if direction == "EAST" else WESTBOUND_SCHEDULE
    board_st = _find_station_entry(station_name, direction)
    alight_st = _find_station_entry(alight_station_name, direction) if alight_station_name else None

    upcoming: list[dict[str, Any]] = []

    # Check today's schedule first, then wrap to early tomorrow morning if late at night
    for day_offset_min in (0.0, 24 * 60.0):
        for h, m, code in schedule:
            origin_dep_min = day_offset_min + h * 60 + m
            board_arr_min = origin_dep_min + board_st["arr_min"]
            board_dep_min = origin_dep_min + board_st["dep_min"]

            if board_dep_min < min_catch_min:
                continue

            eta_dep_min = board_dep_min - minute_of_day
            eta_arr_min = max(0.0, board_arr_min - minute_of_day)
            eta_sec = max(30, int(round(eta_dep_min * 60)))

            alight_arr_str = None
            ride_duration_sec = None
            if alight_st is not None:
                alight_arr_min = origin_dep_min + alight_st["arr_min"]
                alight_arr_str = format_minute_of_day_wib(alight_arr_min)
                if alight_arr_min > board_dep_min:
                    ride_duration_sec = int(round((alight_arr_min - board_dep_min) * 60))

            # Determine live train position & incoming approach track geometry
            elapsed = minute_of_day - origin_dep_min
            if day_offset_min == 0.0 and -2.0 <= elapsed <= TOTAL_JOURNEY_MINUTES:
                live = _evaluate_train_state(elapsed, direction, code, now)
                train_status = live["status"]  # "BOARDING" or "MOVING"
                train_dist_m = live["dist_m"]
                meters_away = max(0.0, round(board_st["dist_m"] - train_dist_m, 1))
                current_station = live["current_station"]
                next_station = live["next_station"]
                approach_geo = (
                    get_track_subline(train_dist_m, board_st["dist_m"], direction)
                    if meters_away > 50.0
                    else None
                )
            else:
                train_status = "SCHEDULED"
                meters_away = round(board_st["dist_m"], 1)
                current_station = None
                next_station = (
                    "Stasiun Padalarang" if direction == "EAST" else "Stasiun Cicalengka"
                )
                # Show faint corridor approach from terminus if boarding isn't the terminus
                approach_geo = (
                    get_track_subline(0.0, board_st["dist_m"], direction)
                    if board_st["dist_m"] > 100.0
                    else None
                )

            upcoming.append({
                "train_number": code,
                "train_name": f"{code} (Commuter Line)",
                "toward": "Cicalengka" if direction == "EAST" else "Padalarang",
                "board_station": board_st["name"],
                "departure_time": format_minute_of_day_wib(board_dep_min),
                "arrival_time_at_board": format_minute_of_day_wib(board_arr_min),
                "scheduled_arrival": alight_arr_str,
                "ride_duration_seconds": ride_duration_sec,
                "eta_seconds": eta_sec,
                "eta_minutes": max(1, int(round(eta_dep_min))),
                "eta_arrival_minutes": int(round(eta_arr_min)),
                "meter_away": meters_away,
                "status": train_status,
                "current_station": current_station,
                "next_station": next_station,
                "approach_geometry": approach_geo,
            })
            if len(upcoming) >= limit:
                return upcoming

    return upcoming


def estimate_next_train(
    corridor_toward: str,
    stop_name: str,
    alight_stop_name: str | None = None,
    walk_lead_seconds: int = 0,
) -> dict[str, Any]:
    """
    Returns the next catchable approaching train, exact WIB departure/arrival schedule,
    live operational status, incoming approach track geometry, and next 3 departures.
    """
    upcoming = get_station_train_schedule(
        station_name=stop_name,
        corridor_toward=corridor_toward,
        alight_station_name=alight_stop_name,
        min_lead_seconds=walk_lead_seconds,
        limit=4,
    )
    if upcoming:
        primary = dict(upcoming[0])
        # Compact schedule list (omit heavy approach_geometry on secondary rows)
        primary["upcoming_schedule"] = [
            {
                "train_number": u["train_number"],
                "departure_time": u["departure_time"],
                "scheduled_arrival": u["scheduled_arrival"],
                "eta_minutes": u["eta_minutes"],
                "status": u["status"],
                "current_station": u["current_station"],
            }
            for u in upcoming[:3]
        ]
        return primary

    is_eastbound = "cicalengka" in corridor_toward.lower()
    return {
        "train_number": "KA 352" if is_eastbound else "KA 355",
        "train_name": "KA 352 (Commuter Line)" if is_eastbound else "KA 355 (Commuter Line)",
        "toward": corridor_toward,
        "departure_time": None,
        "scheduled_arrival": None,
        "meter_away": 4500,
        "eta_seconds": 420,
        "status": "SCHEDULED",
        "current_station": None,
        "next_station": stop_name,
        "approach_geometry": None,
        "upcoming_schedule": [],
    }
