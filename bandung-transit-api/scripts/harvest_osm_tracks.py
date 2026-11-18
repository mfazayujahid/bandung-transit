import httpx
import xml.etree.ElementTree as ET
import networkx as nx
import math
import json
import time

headers = {"User-Agent": "BandungTransitHarvest/1.0 (contact: admin@bandungtransit.local)"}

# 13 Station Anchor Coordinates (from OSM)
anchors = [
    (107.495979, -6.841603), # Stasiun Padalarang
    (107.505000, -6.852500), # Padalarang - Gadobangkong
    (107.514957, -6.864073), # Stasiun Gadobangkong
    (107.525500, -6.875000), # Gadobangkong - Cimahi
    (107.537071, -6.886886), # Stasiun Cimahi
    (107.549000, -6.891500), # Cimahi - Cimindi
    (107.560842, -6.895870), # Stasiun Cimindi
    (107.575000, -6.905000), # Cimindi - Ciroyom
    (107.583000, -6.909800),
    (107.590147, -6.913994), # Stasiun Ciroyom
    (107.601705, -6.914280), # Stasiun Bandung (Hall)
    (107.613500, -6.916200),
    (107.625403, -6.918598), # Stasiun Cikudapateuh
    (107.636000, -6.921500),
    (107.645615, -6.924760), # Stasiun Kiaracondong
    (107.662000, -6.930500),
    (107.676500, -6.936000),
    (107.690510, -6.941084), # Stasiun Gedebage
    (107.701500, -6.945000),
    (107.712130, -6.948964), # Stasiun Cimekar
    (107.728000, -6.954800),
    (107.742000, -6.959800),
    (107.755848, -6.964820), # Stasiun Rancaekek
    (107.772800, -6.971000),
    (107.786000, -6.975800),
    (107.799052, -6.980494), # Stasiun Haurpugur
    (107.815000, -6.980600),
    (107.832059, -6.980729), # Stasiun Cicalengka
]

print(f"Total anchor boxes to query: {len(anchors)}")

node_coords = {}
rail_edges = set()

# Query small 0.014 x 0.008 bbox around each anchor point
dx = 0.008
dy = 0.004

for idx, (lon, lat) in enumerate(anchors, 1):
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={lon-dx:.5f},{lat-dy:.5f},{lon+dx:.5f},{lat+dy:.5f}"
    print(f"[{idx}/{len(anchors)}] Querying around lon={lon:.3f}, lat={lat:.3f} ...", end=" ", flush=True)
    try:
        r = httpx.get(url, headers=headers, timeout=15.0)
        print(f"status {r.status_code}")
        if r.status_code != 200:
            continue
        root = ET.fromstring(r.content)
        # Parse nodes
        for n in root.findall("node"):
            nid = n.attrib["id"]
            nlon = float(n.attrib["lon"])
            nlat = float(n.attrib["lat"])
            node_coords[nid] = (nlon, nlat)
        
        # Parse ways
        for w in root.findall("way"):
            tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
            if tags.get("railway") == "rail":
                service = tags.get("service", "")
                if service in ("yard", "siding", "spur"):
                    continue
                nd_ids = [nd.attrib["ref"] for nd in w.findall("nd")]
                for i in range(len(nd_ids) - 1):
                    u = nd_ids[i]
                    v = nd_ids[i+1]
                    rail_edges.add((u, v))
    except Exception as e:
        print("Error:", e)
    time.sleep(0.15)

print(f"\nCollected {len(node_coords)} nodes and {len(rail_edges)} rail edges!")

# Save to disk
with open("osm_harvest.json", "w") as f:
    json.dump({
        "node_coords": node_coords,
        "edges": list(rail_edges)
    }, f)
print("Saved osm_harvest.json!")
