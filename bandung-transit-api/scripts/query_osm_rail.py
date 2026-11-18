import httpx
import xml.etree.ElementTree as ET

# Bounding box around Stasiun Rancaekek to get the exact railway track coordinates
url = "https://api.openstreetmap.org/api/0.6/map?bbox=107.745,-6.975,107.765,-6.960"
headers = {"User-Agent": "BandungTransit/1.0"}

resp = httpx.get(url, headers=headers, timeout=15.0)
print("Status:", resp.status_code)
root = ET.fromstring(resp.content)

# Map node id to (lon, lat)
nodes = {}
for n in root.findall("node"):
    nid = n.attrib["id"]
    nodes[nid] = (float(n.attrib["lon"]), float(n.attrib["lat"]))

print(f"Total nodes: {len(nodes)}")

# Find railway ways
rail_ways = []
for w in root.findall("way"):
    tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
    if tags.get("railway") in ("rail", "subway"):
        nd_ids = [nd.attrib["ref"] for nd in w.findall("nd")]
        coords = [nodes[nid] for nid in nd_ids if nid in nodes]
        rail_ways.append((tags.get("name", "unnamed"), coords))

print(f"Found {len(rail_ways)} railway ways:")
for name, coords in rail_ways:
    print(f"  Way '{name}': {len(coords)} points, sample: {coords[0]} to {coords[-1]}")
