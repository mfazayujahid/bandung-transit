import networkx as nx
from sqlalchemy import literal_column, text
from sqlalchemy.orm import Session
import json

from app.models.transit import Corridor, Stop, TransferEdge
from app.services.walking import (
    get_walking_route_for_stop,
    haversine_distance_meters,
)
from app.services.station_access import get_station_entrances
from app.services.train_telemetry import (
    estimate_next_train,
    get_current_time_wib,
    format_minute_of_day_wib,
)

WALK_SPEED_MPS = 1.25          # ~4.5 km/h pedestrian pace
BUS_AVG_SPEED_MPS = 5.5        # ~20 km/h Bandung urban traffic fallback
TRAIN_AVG_SPEED_MPS = 13.9     # ~50 km/h Commuter rail cruising speed
TRANSFER_PENALTY_SEC = 360     # 6-minute waiting/boarding penalty per bus transfer
TRAIN_HEADWAY_PENALTY_SEC = 420 # 7-minute waiting penalty for commuter rail
MAX_ACCESS_WALK_M = 800        # Primary walking radius from Point A or Point B to a stop
EXTENDED_ACCESS_WALK_M = 1500  # Fallback walking radius for residential/suburban areas


def format_idr(amount: int) -> str:
    """Format integer rupiah into standard Indonesian currency string (e.g. 4900 -> 'Rp 4.900')."""
    if amount <= 0:
        return "Gratis"
    return f"Rp {amount:,}".replace(",", ".")


def _best_access_distance_m(lng: float, lat: float, stop_info: dict) -> float:
    """
    Estimates walking distance from (lng, lat) to a stop using its active pedestrian
    entrance(s) when available (e.g. railway stations), instead of the railway track centerline.
    """
    entrances = get_station_entrances(stop_info.get("stop_name"))
    if entrances:
        return min(
            haversine_distance_meters(lng, lat, ent["gate"][0], ent["gate"][1])
            for ent in entrances
        )
    sc = stop_info["coords"]
    return haversine_distance_meters(lng, lat, sc[0], sc[1])


def build_transit_graph(db: Session) -> tuple[nx.DiGraph, dict[int, dict]]:
    """
    Constructs a 2-state directed multimodal graph of bus segments, rail segments, and
    walking transfers.
      - ("B", stop_id): Boarding state (can only transition forward along the corridor)
      - ("A", stop_id): Alighting/In-vehicle state (can continue riding, transfer, or egress)

    This 2-state formulation guarantees every transit leg rides at least 1 corridor segment
    and prevents bogus 0-stop rides or chained transfer walks without riding a vehicle.
    """
    graph = nx.DiGraph()

    rows = (
        db.query(
            Stop.id,
            Stop.corridor_id,
            Stop.name,
            Stop.category,
            Stop.sequence,
            Corridor.code,
            Corridor.name.label("corridor_name"),
            Corridor.toward,
            Corridor.color,
            literal_column("ST_X(stops.geom)").label("lng"),
            literal_column("ST_Y(stops.geom)").label("lat"),
            literal_column("ST_LineLocatePoint(corridors.geom, stops.geom)").label("route_frac"),
            literal_column("ST_Length(corridors.geom::geography)").label("route_meters"),
        )
        .join(Corridor, Stop.corridor_id == Corridor.id)
        .order_by(Stop.corridor_id, Stop.sequence)
        .all()
    )

    stop_meta: dict[int, dict] = {}
    stops_by_corridor: dict[int, list] = {}

    for r in rows:
        stop_meta[r.id] = {
            "stop_id": r.id,
            "corridor_id": r.corridor_id,
            "stop_name": r.name,
            "category": r.category,
            "sequence": r.sequence,
            "corridor_code": r.code,
            "corridor_name": r.corridor_name,
            "toward": r.toward,
            "color": r.color,
            "coords": [float(r.lng), float(r.lat)],
            "route_frac": float(r.route_frac) if r.route_frac is not None else 0.0,
        }
        graph.add_node(("B", r.id))
        graph.add_node(("A", r.id))
        stops_by_corridor.setdefault(r.corridor_id, []).append(r)

    for corridor_id, stops in stops_by_corridor.items():
        is_train = stops[0].code == "CLR" or stops[0].category == "Station"
        speed_mps = TRAIN_AVG_SPEED_MPS if is_train else BUS_AVG_SPEED_MPS
        mode = "TRAIN" if is_train else "BUS"

        for i in range(len(stops) - 1):
            curr_stop = stops[i]
            next_stop = stops[i + 1]
            frac_curr = float(curr_stop.route_frac) if curr_stop.route_frac is not None else 0.0
            frac_next = float(next_stop.route_frac) if next_stop.route_frac is not None else 0.0
            frac_delta = frac_next - frac_curr

            default_seg_m = 2500.0 if is_train else 800.0
            seg_meters = (frac_delta * float(curr_stop.route_meters)) if frac_delta > 0 else default_seg_m
            ride_seconds = max(60 if is_train else 45, int(round(seg_meters / speed_mps)))

            # First segment boarded from ("B", curr) -> ("A", next)
            graph.add_edge(
                ("B", curr_stop.id),
                ("A", next_stop.id),
                mode=mode,
                corridor_id=corridor_id,
                seconds=ride_seconds,
            )
            # Continuing in-vehicle from ("A", curr) -> ("A", next)
            graph.add_edge(
                ("A", curr_stop.id),
                ("A", next_stop.id),
                mode=mode,
                corridor_id=corridor_id,
                seconds=ride_seconds,
            )

    transfers = db.query(TransferEdge).all()
    for t in transfers:
        if t.from_stop_id not in stop_meta or t.to_stop_id not in stop_meta:
            continue
        to_is_train = (
            stop_meta[t.to_stop_id]["corridor_code"] == "CLR"
            or stop_meta[t.to_stop_id].get("category") == "Station"
        )
        penalty = TRAIN_HEADWAY_PENALTY_SEC if to_is_train else TRANSFER_PENALTY_SEC
        graph.add_edge(
            ("A", t.from_stop_id),
            ("B", t.to_stop_id),
            mode="TRANSFER",
            walk_meter=t.walk_meter,
            seconds=t.walk_seconds + penalty,
        )

    return graph, stop_meta


def find_nearby_stops(db: Session, lng: float, lat: float, radius_m: int = MAX_ACCESS_WALK_M):
    """Finds candidate boarding/alighting stops within radius_m using spheroid geography."""
    sql = text("""
        SELECT
            id AS stop_id,
            ROUND(ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)::numeric, 1) AS meters
        FROM stops
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
            :radius
        )
        ORDER BY meters ASC
        LIMIT 16;
    """)
    return db.execute(sql, {"lng": lng, "lat": lat, "radius": radius_m}).fetchall()


def estimate_next_bus(
    db: Session,
    corridor_id: int,
    boarding_stop_id: int,
    arrival_offset_sec: int = 0,
) -> dict:
    """
    Uses PostGIS Linear Referencing across the full corridor loop (both directions)
    to select the earliest active bus the passenger can actually catch after arriving
    at `boarding_stop_id` at `now + arrival_offset_sec`.

    Always selects a concrete active vehicle from the corridor fleet (including buses
    approaching upstream OR looping back from the opposite direction for longer transfer
    ETAs) and returns the next 3 catchable vehicles (`upcoming_buses`) plus live
    approach geometry when the selected bus is directly upstream on the current run.
    """
    now_wib = get_current_time_wib()
    now_min = now_wib.hour * 60 + now_wib.minute + (now_wib.second / 60.0)
    passenger_arrival_time = format_minute_of_day_wib(now_min + (arrival_offset_sec / 60.0))
    min_catch_sec = arrival_offset_sec + 30  # 30s boarding safety buffer

    target_info = db.execute(
        text("""
            SELECT
                c.code AS corridor_code,
                ST_Length(c.geom::geography) AS route_len,
                ST_LineLocatePoint(c.geom, s.geom) AS stop_frac
            FROM corridors c
            JOIN stops s ON s.id = :stop_id
            WHERE c.id = :corridor_id;
        """),
        {"corridor_id": corridor_id, "stop_id": boarding_stop_id},
    ).fetchone()

    if not target_info:
        est_wait = TRANSFER_PENALTY_SEC if arrival_offset_sec > 0 else 480
        est_dep = arrival_offset_sec + est_wait
        return {
            "bus_id": None,
            "bus_name": "Armada Berikutnya",
            "plate_number": None,
            "meter_away": None,
            "eta_seconds": est_dep,
            "wait_seconds": est_wait,
            "departure_time": format_minute_of_day_wib(now_min + (est_dep / 60.0)),
            "passenger_arrival_time": passenger_arrival_time,
            "match_type": "ESTIMATED_FUTURE",
            "is_train": False,
            "approach_geometry": None,
            "upcoming_buses": [],
        }

    corridor_code = target_info.corridor_code
    route_len = max(1000.0, float(target_info.route_len or 10000.0))
    stop_frac = max(0.0, min(1.0, float(target_info.stop_frac or 0.0)))

    # Fetch ALL active live buses operating on this corridor code (both directions)
    rows = db.execute(
        text("""
            SELECT
                b.bus_id,
                b.bus_name,
                b.plate_number,
                b.speed_kmh,
                b.corridor_id AS bus_corridor_id,
                ST_LineLocatePoint(c.geom, b.geom) AS bus_frac,
                ST_Length(c.geom::geography) AS bus_route_len
            FROM live_buses b
            JOIN corridors c ON b.corridor_id = c.id
            WHERE c.code = :corridor_code
              AND b.updated_at >= NOW() - INTERVAL '10 minutes';
        """),
        {"corridor_code": corridor_code},
    ).fetchall()

    if not rows:
        est_wait = TRANSFER_PENALTY_SEC if arrival_offset_sec > 0 else 480
        est_dep = arrival_offset_sec + est_wait
        return {
            "bus_id": None,
            "bus_name": f"Armada {corridor_code} Berikutnya",
            "plate_number": None,
            "meter_away": None,
            "eta_seconds": est_dep,
            "wait_seconds": est_wait,
            "departure_time": format_minute_of_day_wib(now_min + (est_dep / 60.0)),
            "passenger_arrival_time": passenger_arrival_time,
            "match_type": "ESTIMATED_FUTURE",
            "is_train": False,
            "approach_geometry": None,
            "upcoming_buses": [],
        }

    cycle_sec = max(1200.0, (2.0 * route_len / BUS_AVG_SPEED_MPS) + 360.0)
    candidates: list[dict] = []

    for row in rows:
        if row.speed_kmh and row.speed_kmh > 3:
            eff_speed = (0.4 * (float(row.speed_kmh) / 3.6)) + (0.6 * BUS_AVG_SPEED_MPS)
        else:
            eff_speed = BUS_AVG_SPEED_MPS

        bus_frac = max(0.0, min(1.0, float(row.bus_frac or 0.0)))
        bus_route_len = max(1000.0, float(row.bus_route_len or route_len))
        same_dir = int(row.bus_corridor_id) == int(corridor_id)

        if same_dir and bus_frac <= stop_frac:
            dist_m = (stop_frac - bus_frac) * route_len
            eta_from_now = dist_m / eff_speed
            direct_upstream = True
        elif not same_dir:
            # Opposite direction: finish opposite run + 3-min turnaround + reach boarding stop
            dist_m = ((1.0 - bus_frac) * bus_route_len) + (stop_frac * route_len)
            eta_from_now = (dist_m / eff_speed) + 180.0
            direct_upstream = False
        else:
            # Same direction, already passed stop: finish run + turnaround + return leg + turnaround + reach stop
            dist_m = ((1.0 - bus_frac) * route_len) + route_len + (stop_frac * route_len)
            eta_from_now = (dist_m / eff_speed) + 360.0
            direct_upstream = False

        # Roll forward full loop cycle(s) if bus passes before passenger arrives at checkpoint
        rolled = False
        while eta_from_now < min_catch_sec:
            eta_from_now += cycle_sec
            dist_m += 2.0 * route_len
            direct_upstream = False
            rolled = True

        eta_sec = int(round(eta_from_now))
        wait_sec = max(30, eta_sec - arrival_offset_sec)

        candidates.append({
            "bus_id": row.bus_id,
            "bus_name": row.bus_name or f"Bus {corridor_code}",
            "plate_number": row.plate_number,
            "bus_frac": bus_frac,
            "meter_away": round(dist_m, 1),
            "eta_seconds": eta_sec,
            "wait_seconds": wait_sec,
            "departure_time": format_minute_of_day_wib(now_min + (eta_sec / 60.0)),
            "direct_upstream": direct_upstream,
            "rolled": rolled,
        })

    candidates.sort(key=lambda c: c["eta_seconds"])
    best = candidates[0]

    approach_geo = None
    if best["direct_upstream"] and best["bus_frac"] < stop_frac and best["meter_away"] > 25.0:
        geo_row = db.execute(
            text("SELECT ST_AsGeoJSON(ST_LineSubstring(geom, :f1, :f2)) AS geo FROM corridors WHERE id = :cid"),
            {"f1": best["bus_frac"], "f2": stop_frac, "cid": corridor_id},
        ).fetchone()
        if geo_row and geo_row.geo:
            approach_geo = json.loads(geo_row.geo)

    upcoming_buses = [
        {
            "bus_id": c["bus_id"],
            "bus_name": c["bus_name"],
            "plate_number": c["plate_number"],
            "departure_time": c["departure_time"],
            "wait_minutes": max(1, int(round(c["wait_seconds"] / 60.0))),
            "eta_minutes": max(1, int(round(c["eta_seconds"] / 60.0))),
            "direct_upstream": c["direct_upstream"],
        }
        for c in candidates[:3]
    ]

    return {
        "bus_id": best["bus_id"],
        "bus_name": best["bus_name"],
        "plate_number": best["plate_number"],
        "meter_away": best["meter_away"],
        "eta_seconds": best["eta_seconds"],
        "wait_seconds": best["wait_seconds"],
        "departure_time": best["departure_time"],
        "passenger_arrival_time": passenger_arrival_time,
        "match_type": "LIVE_CATCHABLE" if best["direct_upstream"] else "LIVE_LOOP_SYNCED",
        "is_train": False,
        "approach_geometry": approach_geo,
        "upcoming_buses": upcoming_buses,
    }


def get_corridor_segment_geojson(
    db: Session,
    corridor_id: int,
    start_frac: float,
    end_frac: float,
    fallback_coords: list,
) -> dict:
    f1 = max(0.0, min(1.0, start_frac))
    f2 = max(0.0, min(1.0, end_frac))
    if f1 < f2:
        row = db.execute(
            text("SELECT ST_AsGeoJSON(ST_LineSubstring(geom, :f1, :f2)) AS geo FROM corridors WHERE id = :cid"),
            {"f1": f1, "f2": f2, "cid": corridor_id},
        ).fetchone()
        if row and row.geo:
            return json.loads(row.geo)
    elif f1 > f2:
        row = db.execute(
            text("SELECT ST_AsGeoJSON(ST_Reverse(ST_LineSubstring(geom, :f2, :f1))) AS geo FROM corridors WHERE id = :cid"),
            {"f1": f1, "f2": f2, "cid": corridor_id},
        ).fetchone()
        if row and row.geo:
            return json.loads(row.geo)
    return {"type": "LineString", "coordinates": fallback_coords}


def _find_shortest_path_with_radius(
    db: Session,
    base_graph: nx.DiGraph,
    stop_meta: dict[int, dict],
    origin_lng: float,
    origin_lat: float,
    dest_lng: float,
    dest_lat: float,
    radius_m: int,
) -> list | None:
    origin_stops = find_nearby_stops(db, origin_lng, origin_lat, radius_m=radius_m)
    dest_stops = find_nearby_stops(db, dest_lng, dest_lat, radius_m=radius_m)
    if not origin_stops or not dest_stops:
        return None

    graph = base_graph.copy()

    for s in origin_stops:
        if s.stop_id not in stop_meta:
            continue
        est_m = _best_access_distance_m(origin_lng, origin_lat, stop_meta[s.stop_id])
        walk_sec = int(round(est_m / WALK_SPEED_MPS))
        graph.add_edge("ORIGIN", ("B", s.stop_id), mode="ACCESS_WALK", walk_meter=est_m, seconds=walk_sec)

    for s in dest_stops:
        if s.stop_id not in stop_meta:
            continue
        est_m = _best_access_distance_m(dest_lng, dest_lat, stop_meta[s.stop_id])
        walk_sec = int(round(est_m / WALK_SPEED_MPS))
        graph.add_edge(("A", s.stop_id), "DEST", mode="EGRESS_WALK", walk_meter=est_m, seconds=walk_sec)

    try:
        return nx.shortest_path(graph, source="ORIGIN", target="DEST", weight="seconds")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def plan_trip(
    db: Session,
    origin_lng: float,
    origin_lat: float,
    dest_lng: float,
    dest_lat: float,
) -> dict:
    base_graph, stop_meta = build_transit_graph(db)

    path = _find_shortest_path_with_radius(
        db, base_graph, stop_meta, origin_lng, origin_lat, dest_lng, dest_lat, MAX_ACCESS_WALK_M
    )
    if path is None:
        path = _find_shortest_path_with_radius(
            db, base_graph, stop_meta, origin_lng, origin_lat, dest_lng, dest_lat, EXTENDED_ACCESS_WALK_M
        )

    if path is None:
        return {
            "error": f"No connected transit path found within {EXTENDED_ACCESS_WALK_M}m of origin or destination."
        }

    # Extract stop sequence from 2-state nodes: ("B", sid) / ("A", sid)
    state_nodes = [node for node in path if isinstance(node, tuple)]
    ride_groups: list[list[int]] = []
    for state, sid in state_nodes:
        if state == "B":
            ride_groups.append([sid])
        elif state == "A" and ride_groups:
            ride_groups[-1].append(sid)

    # Filter out any malformed < 2 stop groups (guaranteed empty by 2-state graph, kept as safeguard)
    ride_groups = [g for g in ride_groups if len(g) >= 2]
    if not ride_groups:
        return {"error": "No valid transit ride segment found between these two locations."}

    first_stop = stop_meta[ride_groups[0][0]]
    last_stop = stop_meta[ride_groups[-1][-1]]

    legs = []
    total_seconds = 0

    # 1. First-mile Access Walk (entrance-aware for railway stations!)
    first_walk_route = get_walking_route_for_stop(
        origin_lng,
        origin_lat,
        first_stop["coords"][0],
        first_stop["coords"][1],
        to_stop_name=first_stop["stop_name"],
    )
    first_walk_s = first_walk_route["duration_seconds"]
    first_walk_m = first_walk_route["distance_meters"]
    entrance_label = first_walk_route.get("entrance_label")
    walk_to_label = (
        f"{first_stop['stop_name']} ({entrance_label})"
        if entrance_label
        else first_stop["stop_name"]
    )
    total_seconds += first_walk_s
    legs.append({
        "type": "WALK",
        "instruction": f"Walk {int(round(first_walk_m))}m to {walk_to_label}",
        "duration_seconds": first_walk_s,
        "distance_meters": first_walk_m,
        "from_coords": [origin_lng, origin_lat],
        "to_coords": first_stop["coords"],
        "geometry": first_walk_route["geometry"],
        "fare_idr": 0,
        "fare_formatted": "Gratis",
        "operator": "Jalan Kaki",
        "payment_methods": [],
    })

    # 2. Transit Ride Legs + Transfer Walks
    for idx, group in enumerate(ride_groups):
        board = stop_meta[group[0]]
        alight = stop_meta[group[-1]]
        stop_coords = [stop_meta[s]["coords"] for s in group]
        is_train = board["corridor_code"] == "CLR" or board.get("category") == "Station"

        ride_sec = 0
        for i in range(len(group) - 1):
            u = ("B", group[i]) if i == 0 else ("A", group[i])
            v = ("A", group[i + 1])
            ride_sec += base_graph.edges[u, v]["seconds"]
        ride_sec = max(60, ride_sec)

        segment_geo = get_corridor_segment_geojson(
            db=db,
            corridor_id=board["corridor_id"],
            start_frac=board["route_frac"],
            end_frac=alight["route_frac"],
            fallback_coords=stop_coords,
        )

        # Cumulative ETA from NOW when passenger physically arrives at this boarding checkpoint
        checkpoint_eta_sec = total_seconds
        now_wib = get_current_time_wib()
        now_min = now_wib.hour * 60 + now_wib.minute + (now_wib.second / 60.0)
        passenger_arrival_time = format_minute_of_day_wib(now_min + (checkpoint_eta_sec / 60.0))

        if is_train:
            train_est = estimate_next_train(
                board.get("toward") or "Cicalengka",
                board["stop_name"],
                alight_stop_name=alight["stop_name"],
                walk_lead_seconds=checkpoint_eta_sec + 45,
            )
            # Actual wait at the station platform after arriving (no double-counting walk/previous legs!)
            wait_sec = max(45, int(train_est["eta_seconds"]) - checkpoint_eta_sec)
            # Use exact GAPEKA ride duration when available so downstream bus transfer ETAs match exact train arrival!
            if train_est.get("ride_duration_seconds"):
                ride_sec = max(60, int(train_est["ride_duration_seconds"]))
            incoming_vehicle = {
                "bus_id": train_est["train_number"],
                "bus_name": train_est["train_name"],
                "plate_number": train_est["train_number"],
                "meter_away": train_est["meter_away"],
                "eta_seconds": train_est["eta_seconds"],
                "wait_seconds": wait_sec,
                "passenger_arrival_time": passenger_arrival_time,
                "is_train": True,
                "train_number": train_est["train_number"],
                "departure_time": train_est.get("departure_time"),
                "scheduled_arrival": train_est.get("scheduled_arrival"),
                "status": train_est.get("status", "SCHEDULED"),
                "current_station": train_est.get("current_station"),
                "next_station": train_est.get("next_station"),
                "approach_geometry": train_est.get("approach_geometry"),
                "upcoming_schedule": train_est.get("upcoming_schedule", []),
            }
            leg_type = "TRAIN"
        else:
            incoming_bus = estimate_next_bus(
                db,
                board["corridor_id"],
                board["stop_id"],
                arrival_offset_sec=checkpoint_eta_sec,
            )
            incoming_vehicle = incoming_bus
            wait_sec = int(incoming_bus.get("wait_seconds", TRANSFER_PENALTY_SEC))
            leg_type = "BUS"

        total_seconds += wait_sec + ride_sec

        if is_train:
            fare_val = 5000
            operator_name = "KAI Commuter"
            pay_methods = ["KMT", "E-Money Bank (Flazz, TapCash, Brizzi, e-Money)", "QR Code Access by KAI"]
        else:
            fare_val = 4900
            operator_name = "Metro Jabar Trans / Teman Bus"
            pay_methods = ["QRIS", "E-Money Bank (Flazz, TapCash, Brizzi, e-Money)"]

        legs.append({
            "type": leg_type,
            "transit_mode": leg_type,
            "corridor_id": board["corridor_id"],
            "corridor_code": board["corridor_code"],
            "corridor_name": board["corridor_name"],
            "toward": board["toward"],
            "color": board["color"] or ("#1e3a8a" if is_train else "#2563eb"),
            "board_stop": board["stop_name"],
            "alight_stop": alight["stop_name"],
            "stop_count": len(group),
            "stop_coords": stop_coords,
            "geometry": segment_geo,
            "incoming_bus": incoming_vehicle,
            "incoming_vehicle": incoming_vehicle,
            "duration_seconds": wait_sec + ride_sec,
            "fare_idr": fare_val,
            "fare_formatted": format_idr(fare_val),
            "operator": operator_name,
            "payment_methods": pay_methods,
        })

        if idx < len(ride_groups) - 1:
            next_board = stop_meta[ride_groups[idx + 1][0]]
            alight_coords = alight["coords"]
            next_coords = next_board["coords"]
            transfer_walk_route = get_walking_route_for_stop(
                alight_coords[0],
                alight_coords[1],
                next_coords[0],
                next_coords[1],
                from_stop_name=alight["stop_name"],
                to_stop_name=next_board["stop_name"],
            )
            t_walk_s = transfer_walk_route["duration_seconds"]
            t_walk_m = transfer_walk_route["distance_meters"]
            total_seconds += t_walk_s
            legs.append({
                "type": "TRANSFER_WALK",
                "instruction": f"Transfer at {alight['stop_name']} -> walk {int(round(t_walk_m))}m to {next_board['stop_name']}",
                "duration_seconds": t_walk_s,
                "distance_meters": t_walk_m,
                "from_coords": alight_coords,
                "to_coords": next_coords,
                "geometry": transfer_walk_route["geometry"],
                "fare_idr": 0,
                "fare_formatted": "Gratis",
                "operator": "Jalan Kaki",
                "payment_methods": [],
            })

    # 3. Last-mile Egress Walk (entrance-aware for railway stations!)
    last_stop_coords = last_stop["coords"]
    last_walk_route = get_walking_route_for_stop(
        last_stop_coords[0],
        last_stop_coords[1],
        dest_lng,
        dest_lat,
        from_stop_name=last_stop["stop_name"],
    )
    last_walk_s = last_walk_route["duration_seconds"]
    last_walk_m = last_walk_route["distance_meters"]
    exit_label = last_walk_route.get("entrance_label")
    walk_from_label = (
        f"{last_stop['stop_name']} ({exit_label})"
        if exit_label
        else last_stop["stop_name"]
    )
    total_seconds += last_walk_s
    legs.append({
        "type": "WALK",
        "instruction": f"Walk {int(round(last_walk_m))}m from {walk_from_label} to destination",
        "duration_seconds": last_walk_s,
        "distance_meters": last_walk_m,
        "from_coords": last_stop_coords,
        "to_coords": [dest_lng, dest_lat],
        "geometry": last_walk_route["geometry"],
        "fare_idr": 0,
        "fare_formatted": "Gratis",
        "operator": "Jalan Kaki",
        "payment_methods": [],
    })

    # 4. Compute Total Estimated Fare & Detailed Breakdown
    total_fare_idr = sum(leg.get("fare_idr", 0) for leg in legs)
    discounted_fare_idr = 0
    fare_breakdown = []

    for leg in legs:
        if leg["type"] == "TRAIN":
            discounted_fare_idr += 5000  # KAI Commuter PSO flat fare
            fare_breakdown.append({
                "name": leg.get("corridor_name") or "Commuter Line Bandung Raya",
                "type": "TRAIN",
                "fare_idr": 5000,
                "fare_formatted": format_idr(5000),
                "operator": "KAI Commuter",
                "payment_methods": leg.get("payment_methods", []),
            })
        elif leg["type"] == "BUS":
            discounted_fare_idr += 2000  # Tarif khusus pelajar/mahasiswa/lansia/disabilitas
            fare_breakdown.append({
                "name": f"Bus {leg.get('corridor_code', '')} ({leg.get('corridor_name', '')})",
                "type": "BUS",
                "fare_idr": 4900,
                "fare_formatted": format_idr(4900),
                "operator": "Metro Jabar Trans / Teman Bus",
                "payment_methods": leg.get("payment_methods", []),
            })

    fare_info = {
        "total_fare_idr": total_fare_idr,
        "total_fare_formatted": format_idr(total_fare_idr),
        "discounted_fare_idr": discounted_fare_idr,
        "discounted_fare_formatted": format_idr(discounted_fare_idr),
        "fare_breakdown": fare_breakdown,
        "payment_summary": "Non-tunai (QRIS / Uang Elektronik / KMT)",
        "note": "Tarif bus MJT Rp 4.900 (Rp 2.000 tarif khusus pelajar/lansia); Kereta Commuter Line Rp 5.000 (PSO).",
    }

    return {
        "total_duration_seconds": total_seconds,
        "total_duration_minutes": round(total_seconds / 60, 1),
        "total_fare_idr": total_fare_idr,
        "total_fare_formatted": format_idr(total_fare_idr),
        "fare": fare_info,
        "legs": legs,
    }
