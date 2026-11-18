import httpx
import xml.etree.ElementTree as ET
import networkx as nx
import math
import json
import time

headers = {"User-Agent": "BandungTransitBuild/1.0 (contact: admin@bandungtransit.local)"}

tiles = [
    (107.46, -6.86, 107.51, -6.82),  # Padalarang - Gadobangkong
    (107.50, -6.89, 107.55, -6.85),  # Gadobangkong - Cimahi
    (107.54, -6.92, 107.59, -6.88),  # Cimahi - Cimindi - Ciroyom
    (107.58, -6.93, 107.63, -6.90),  # Ciroyom - Bandung - Cikudapateuh
    (107.62, -6.94, 107.67, -6.91),  # Cikudapateuh - Kiaracondong
    (107.66, -6.96, 107.71, -6.92),  # Kiaracondong - Gedebage
    (107.70, -6.97, 107.75, -6.93),  # Gedebage - Cimekar
    (107.74, -6.98, 107.79, -6.95),  # Cimekar - Rancaekek
    (107.78, -6.99, 107.83, -6.96),  # Rancaekek - Haurpugur
    (107.82, -6.99, 107.86, -6.96),  # Haurpugur - Cicalengka
]

G = nx.Graph()
node_coords = {}

print("Fetching 10 tiles along railway corridor from OpenStreetMap API...")

for i, (min_lon, min_lat, max_lon, max_lat) in enumerate(tiles, 1):
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f}"
    print(f"Fetching tile {i}/{len(tiles)}: [{min_lon}, {min_lat}, {max_lon}, {max_lat}] ...", end=" ", flush=True)
    try:
        resp = httpx.get(url, headers=headers, timeout=20.0)
        print(f"status {resp.status_code}")
        if resp.status_code != 200:
            continue
        
        root = ET.fromstring(resp.content)
        # Parse nodes
        for n in root.findall("node"):
            nid = n.attrib["id"]
            lon = float(n.attrib["lon"])
            lat = float(n.attrib["lat"])
            node_coords[nid] = (lon, lat)
        
        # Parse railway ways
        for w in root.findall("way"):
            tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
            if tags.get("railway") == "rail":
                service = tags.get("service", "")
                if service in ("yard", "siding", "spur"):
                    continue
                nd_ids = [nd.attrib["ref"] for nd in w.findall("nd")]
                for idx in range(len(nd_ids) - 1):
                    u = nd_ids[idx]
                    v = nd_ids[idx+1]
                    if u in node_coords and v in node_coords:
                        p1 = node_coords[u]
                        p2 = node_coords[v]
                        dist = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                        G.add_edge(u, v, weight=dist)
    except Exception as e:
        print("Error:", e)
    time.sleep(0.3)

print(f"\nGraph constructed with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges!")

# Target endpoints:
# Padalarang: [107.495979, -6.841603]
# Cicalengka: [107.832059, -6.980729]
def find_closest_node(target_lon, target_lat):
    best_n = None
    min_dist = 999999
    for n in G.nodes:
        lon, lat = node_coords[n]
        d = math.hypot(lon - target_lon, lat - target_lat)
        if d < min_dist:
            min_dist = d
            best_n = n
    return best_n

pdl_node = find_closest_node(107.495979, -6.841603)
ccl_node = find_closest_node(107.832059, -6.980729)

print(f"Closest node to Padalarang: {pdl_node} at {node_coords.get(pdl_node)}")
print(f"Closest node to Cicalengka: {ccl_node} at {node_coords.get(ccl_node)}")

try:
    path = nx.shortest_path(G, source=pdl_node, target=ccl_node, weight='weight')
    print(f"SUCCESS! Continuous railway path found with {len(path)} high-res points!")
    
    track_coords = [[round(node_coords[n][0], 6), round(node_coords[n][1], 6)] for n in path]
    
    # Save to file
    with open("bandung_railway_true_track.json", "w") as f:
        json.dump(track_coords, f)
    print("Saved high-res track to bandung_railway_true_track.json!")
    
except Exception as e:
    print("Pathfinding error:", e)
    # If graph is disconnected across a tile boundary, list connected components
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    print(f"Graph has {len(comps)} components. Largest component has {len(comps[0])} nodes.")
