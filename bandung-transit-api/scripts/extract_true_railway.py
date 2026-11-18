import httpx
import xml.etree.ElementTree as ET
import json
import math

headers = {"User-Agent": "BandungTransit/1.0 (contact: admin@bandungtransit.local)"}

boxes = [
    (107.46, -6.89, 107.55, -6.83),  # Padalarang - Cimahi
    (107.54, -6.93, 107.65, -6.88),  # Cimahi - Bandung - Cikudapateuh
    (107.64, -6.96, 107.74, -6.92),  # Kiaracondong - Gedebage - Cimekar
    (107.73, -6.99, 107.85, -6.95),  # Rancaekek - Haurpugur - Cicalengka
]

all_segments = []

for idx, (min_lon, min_lat, max_lon, max_lat) in enumerate(boxes):
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={min_lon},{min_lat},{max_lon},{max_lat}"
    print(f"Fetching box {idx+1}/{len(boxes)}: {min_lon},{min_lat} to {max_lon},{max_lat}...")
    try:
        resp = httpx.get(url, headers=headers, timeout=25.0)
        if resp.status_code != 200:
            print(f"Failed box {idx+1}: {resp.status_code}")
            continue
        root = ET.fromstring(resp.content)
        nodes = {}
        for n in root.findall("node"):
            nodes[n.attrib["id"]] = (float(n.attrib["lon"]), float(n.attrib["lat"]))
        
        for w in root.findall("way"):
            tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
            if tags.get("railway") == "rail":
                usage = tags.get("usage", "")
                service = tags.get("service", "")
                # Skip yard/siding spurs
                if service in ("yard", "siding", "spur"):
                    continue
                nd_ids = [nd.attrib["ref"] for nd in w.findall("nd")]
                pts = [nodes[nid] for nid in nd_ids if nid in nodes]
                if len(pts) >= 2:
                    all_segments.append(pts)
    except Exception as e:
        print(f"Error box {idx+1}:", e)

print(f"Total railway segments collected: {len(all_segments)}")

# Now let's assemble a continuous track from west (Padalarang ~107.47) to east (Cicalengka ~107.84)
# We can find all points, sort or chain them along longitude
# Let's write all segments to JSON
with open("osm_rail_segments.json", "w") as f:
    json.dump(all_segments, f)
print("Saved osm_rail_segments.json")
