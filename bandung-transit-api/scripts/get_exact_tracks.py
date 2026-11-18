import httpx
import xml.etree.ElementTree as ET
import json

headers = {"User-Agent": "BandungTransit/1.0"}

stations_approx = [
    ("Padalarang", 107.496, -6.842),
    ("Gadobangkong", 107.515, -6.864),
    ("Cimahi", 107.540, -6.884),
    ("Cimindi", 107.561, -6.896),
    ("Ciroyom", 107.590, -6.914),
    ("Bandung", 107.602, -6.914),
    ("Cikudapateuh", 107.626, -6.919),
    ("Kiaracondong", 107.646, -6.925),
    ("Gedebage", 107.690, -6.941),
    ("Cimekar", 107.712, -6.949),
    ("Rancaekek", 107.756, -6.965),
    ("Haurpugur", 107.799, -6.980),
    ("Cicalengka", 107.833, -6.981),
]

station_tracks = []

for name, approx_lon, approx_lat in stations_approx:
    d = 0.008
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={approx_lon-d:.4f},{approx_lat-d:.4f},{approx_lon+d:.4f},{approx_lat+d:.4f}"
    try:
        r = httpx.get(url, headers=headers, timeout=15.0)
        if r.status_code != 200:
            print(f"{name}: status {r.status_code}")
            continue
        root = ET.fromstring(r.content)
        nodes = {}
        for n in root.findall("node"):
            nodes[n.attrib["id"]] = (float(n.attrib["lon"]), float(n.attrib["lat"]))
        
        main_tracks = []
        for w in root.findall("way"):
            tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
            if tags.get("railway") == "rail" and tags.get("service") not in ("yard", "siding", "spur"):
                nd_ids = [nd.attrib["ref"] for nd in w.findall("nd")]
                pts = [nodes[nid] for nid in nd_ids if nid in nodes]
                if pts:
                    main_tracks.append((tags.get("name", ""), pts))
        
        # Pick the closest point to approx_lon, approx_lat
        best_pt = None
        min_dist = 999999
        for tname, pts in main_tracks:
            for p in pts:
                dist = (p[0] - approx_lon)**2 + (p[1] - approx_lat)**2
                if dist < min_dist:
                    min_dist = dist
                    best_pt = p
        
        if best_pt:
            print(f"Stasiun {name}: exact track coord = [{best_pt[0]:.6f}, {best_pt[1]:.6f}]")
            station_tracks.append({"name": f"Stasiun {name}", "coords": [round(best_pt[0], 6), round(best_pt[1], 6)]})
    except Exception as e:
        print(f"Error {name}:", e)

print("\nFinal results:")
print(json.dumps(station_tracks, indent=2))
