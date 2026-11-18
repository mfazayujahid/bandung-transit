import httpx
import xml.etree.ElementTree as ET

headers = {"User-Agent": "BandungTransit/1.0"}

def get_track_pt(lon, lat):
    d = 0.003
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={lon-d:.4f},{lat-d:.4f},{lon+d:.4f},{lat+d:.4f}"
    r = httpx.get(url, headers=headers, timeout=10.0)
    root = ET.fromstring(r.content)
    nodes = {n.attrib["id"]: (float(n.attrib["lon"]), float(n.attrib["lat"])) for n in root.findall("node")}
    best = None
    min_d = 999
    for w in root.findall("way"):
        tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
        if tags.get("railway") == "rail":
            for nd in w.findall("nd"):
                nid = nd.attrib["ref"]
                if nid in nodes:
                    p = nodes[nid]
                    dist = (p[0] - lon)**2 + (p[1] - lat)**2
                    if dist < min_d:
                        min_d = dist
                        best = p
    return best

print("Ciroyom track:", get_track_pt(107.590, -6.914))
print("Kiaracondong track:", get_track_pt(107.646, -6.925))
