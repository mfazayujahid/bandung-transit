import re
import httpx
import polyline
from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import sessionLocal
from app.models.transit import Corridor, Stop

TRANSFER_SQL = text("""
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
        WHERE ST_DWithin(a.geom::geography, b.geom::geography, 320)
        ON CONFLICT (from_stop_id, to_stop_id) DO NOTHING;
    """)

def fetch_mjt_routes() -> list[dict]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    with httpx.Client(headers=headers, follow_redirects=True, timeout=20.0) as client:
        # Load the PIS page to initialize session cookies and extract the required dynamic nonce
        page_resp = client.get("https://mjt.trans.my.id/pis")
        page_resp.raise_for_status()

        match = re.search(r"pisNonce:\s*'([^']+)'", page_resp.text)
        ajax_headers = {
            "Referer": str(page_resp.url),
            "X-Requested-With": "XMLHttpRequest",
        }
        if match:
            ajax_headers["X-PIS-Nonce"] = match.group(1)

        response = client.get(settings.MJT_ROUTES_URL, headers=ajax_headers)
        response.raise_for_status()
        payload = response.json()
        return payload.get("data", [])

def seed_transit_network(db: Session) -> None:
    routes = fetch_mjt_routes()
    print(f"Fetched {len(routes)} directional routes for MJT.")
    db.execute(text("TRUNCATE TABLE transfer_edges, stops, corridors RESTART IDENTITY CASCADE"))

    for item in routes:
        encoded_points = item.get("points") or ""
        shelters = item.get("shelters") or []

        if not encoded_points or not shelters:
            continue

        decoded_lat_lng = polyline.decode(encoded_points)
        if len(decoded_lat_lng) < 2:
            continue

        wkt_coords = ", ".join(f"{lng} {lat}" for lat, lng in decoded_lat_lng)
        linestring_wkt = f"SRID=4326;LINESTRING({wkt_coords})"

        ext_id = str(item["id"])
        corridor = db.query(Corridor).filter(Corridor.external_id == ext_id).first()

        if corridor:
            corridor.code = item.get("kor", "")
            corridor.name = item.get("route", "")
            corridor.toward = item.get("toward")
            corridor.operating_hours = item.get("jam_ops")
            corridor.color = item.get("color") or "#2563eb"
            corridor.geom = linestring_wkt
        else:
            corridor = Corridor(external_id=ext_id,
                code=item.get("kor", ""),
                name=item.get("route", ""),
                toward=item.get("toward"),
                operating_hours=item.get("jam_ops"),
                color=item.get("color") or "#2563eb",
                geom=linestring_wkt,
            )
            db.add(corridor)
        db.flush()

        for seq, shelter in enumerate(shelters, start=1):
            lat = shelter.get("latitude")
            lng = shelter.get("longitude")
            if lat is None or lng is None:
                continue

            stop = Stop(
                corridor_id=corridor.id,
                name=shelter.get("nama_selter", f"Stop {seq}"),
                category=shelter.get("kategori", "Shelter"),
                sequence=seq,
                geom=f"SRID=4326;POINT({lng} {lat})",
            )
            db.add(stop)
    
    db.commit()

    result = db.execute(TRANSFER_SQL)
    db.commit()
    if isinstance(result, CursorResult):
        print(f"Generated {result.rowcount} walkable transfer edges")

if __name__ == "__main__":
    with sessionLocal() as session:
        seed_transit_network(session)