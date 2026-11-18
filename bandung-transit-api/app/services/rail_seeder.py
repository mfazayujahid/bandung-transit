"""
Rail Seeder for Commuter Line Bandung Raya (Padalarang - Cicalengka).
Seeds Corridor CLR (both directions) and 13 railway stations,
along with transfer walking edges connecting stations to nearby BRT shelters.
All station and track coordinates are grounded directly on 594 OpenStreetMap railway infrastructure nodes.
"""

import json
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.session import sessionLocal
from app.models.transit import Corridor, Stop

# 13 Official Stations of Commuter Line Bandung Raya (Exact OSM Railway Platform Coordinates)
STATIONS_EASTBOUND = [
    {"name": "Stasiun Padalarang", "code": "PDL", "lng": 107.496856, "lat": -6.842418},
    {"name": "Stasiun Gadobangkong", "code": "GK", "lng": 107.514957, "lat": -6.864073},
    {"name": "Stasiun Cimahi", "code": "CMI", "lng": 107.535882, "lat": -6.885540},
    {"name": "Stasiun Cimindi", "code": "CMD", "lng": 107.560851, "lat": -6.895832},
    {"name": "Stasiun Ciroyom", "code": "CIR", "lng": 107.589832, "lat": -6.913816},
    {"name": "Stasiun Bandung", "code": "BD", "lng": 107.601705, "lat": -6.914280},
    {"name": "Stasiun Cikudapateuh", "code": "CTH", "lng": 107.625403, "lat": -6.918598},
    {"name": "Stasiun Kiaracondong", "code": "KAC", "lng": 107.645249, "lat": -6.924585},
    {"name": "Stasiun Gedebage", "code": "GDB", "lng": 107.688936, "lat": -6.940511},
    {"name": "Stasiun Cimekar", "code": "CMK", "lng": 107.712130, "lat": -6.948964},
    {"name": "Stasiun Rancaekek", "code": "RCK", "lng": 107.755848, "lat": -6.964820},
    {"name": "Stasiun Haurpugur", "code": "HRP", "lng": 107.799052, "lat": -6.980494},
    {"name": "Stasiun Cicalengka", "code": "CCL", "lng": 107.833287, "lat": -6.982192},
]

# High-resolution track coordinates (594 continuous nodes along the real physical railway tracks)
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "bandung_railway_track.json"
if DATA_FILE.exists():
    with open(DATA_FILE, "r") as f:
        TRACK_COORDS = json.load(f)
else:
    # Emergency fallback if data file is missing
    TRACK_COORDS = [[st["lng"], st["lat"]] for st in STATIONS_EASTBOUND]

def seed_commuter_line(db: Session) -> None:
    print(f"Seeding Commuter Line Bandung Raya with {len(TRACK_COORDS)} true OSM railway track points...")
    
    # 1. Clean up existing CLR corridors if re-seeding
    existing_clr = db.query(Corridor).filter(Corridor.code == "CLR").all()
    for c in existing_clr:
        # Delete transfer edges referencing stops in this corridor
        db.execute(text("""
            DELETE FROM transfer_edges
            WHERE from_stop_id IN (SELECT id FROM stops WHERE corridor_id = :cid)
               OR to_stop_id IN (SELECT id FROM stops WHERE corridor_id = :cid)
        """), {"cid": c.id})
        db.execute(text("DELETE FROM stops WHERE corridor_id = :cid"), {"cid": c.id})
        db.delete(c)
    db.commit()

    # 2. Build WKT LineStrings
    wkt_east = "SRID=4326;LINESTRING(" + ", ".join(f"{c[0]} {c[1]}" for c in TRACK_COORDS) + ")"
    wkt_west = "SRID=4326;LINESTRING(" + ", ".join(f"{c[0]} {c[1]}" for c in reversed(TRACK_COORDS)) + ")"

    # 3. Create Eastbound Corridor (Padalarang -> Cicalengka)
    corridor_east = Corridor(
        external_id="CLR_EAST",
        code="CLR",
        name="Commuter Line Bandung Raya",
        toward="Cicalengka",
        operating_hours="04:30 - 23:00",
        color="#1e3a8a",
        geom=wkt_east,
    )
    db.add(corridor_east)
    db.flush()

    for seq, st in enumerate(STATIONS_EASTBOUND, start=1):
        stop = Stop(
            corridor_id=corridor_east.id,
            name=st["name"],
            category="Station",
            sequence=seq,
            geom=f"SRID=4326;POINT({st['lng']} {st['lat']})",
        )
        db.add(stop)
    db.flush()

    # 4. Create Westbound Corridor (Cicalengka -> Padalarang)
    corridor_west = Corridor(
        external_id="CLR_WEST",
        code="CLR",
        name="Commuter Line Bandung Raya",
        toward="Padalarang",
        operating_hours="04:30 - 23:00",
        color="#1e3a8a",
        geom=wkt_west,
    )
    db.add(corridor_west)
    db.flush()

    for seq, st in enumerate(reversed(STATIONS_EASTBOUND), start=1):
        stop = Stop(
            corridor_id=corridor_west.id,
            name=st["name"],
            category="Station",
            sequence=seq,
            geom=f"SRID=4326;POINT({st['lng']} {st['lat']})",
        )
        db.add(stop)
    db.commit()

    # 5. Connect Stations to nearby Bus Stops with Transfer Edges (within 450m)
    transfer_sql = text("""
        INSERT INTO transfer_edges (from_stop_id, to_stop_id, walk_meter, walk_seconds)
        SELECT
            a.id AS from_stop_id,
            b.id AS to_stop_id,
            ROUND(ST_Distance(a.geom::geography, b.geom::geography)::numeric, 1) AS walk_meter,
            ROUND(ST_Distance(a.geom::geography, b.geom::geography) / 1.2) AS walk_seconds
        FROM stops a
        JOIN stops b
            ON a.id <> b.id
            AND a.corridor_id <> b.corridor_id
        WHERE (a.category = 'Station' OR b.category = 'Station')
          AND ST_DWithin(a.geom::geography, b.geom::geography, 450)
        ON CONFLICT (from_stop_id, to_stop_id) DO NOTHING;
    """)
    result = db.execute(transfer_sql)
    db.commit()
    print(f"Added station transfer edges: {result.rowcount}")
    print("Commuter Line Bandung Raya updated successfully with high-res true track!")

if __name__ == "__main__":
    with sessionLocal() as session:
        seed_commuter_line(session)
