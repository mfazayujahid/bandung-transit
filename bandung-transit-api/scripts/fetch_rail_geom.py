import httpx
import json

stations = [
    {"name": "Stasiun Padalarang", "code": "PDL", "lng": 107.4735, "lat": -6.8372},
    {"name": "Stasiun Gadobangkong", "code": "GK", "lng": 107.5085, "lat": -6.8631},
    {"name": "Stasiun Cimahi", "code": "CMI", "lng": 107.5422, "lat": -6.8845},
    {"name": "Stasiun Cimindi", "code": "CMD", "lng": 107.5615, "lat": -6.8974},
    {"name": "Stasiun Ciroyom", "code": "CIR", "lng": 107.5928, "lat": -6.9135},
    {"name": "Stasiun Bandung", "code": "BD", "lng": 107.6025, "lat": -6.9142},
    {"name": "Stasiun Cikudapateuh", "code": "CTH", "lng": 107.6254, "lat": -6.9198},
    {"name": "Stasiun Kiaracondong", "code": "KAC", "lng": 107.6468, "lat": -6.9248},
    {"name": "Stasiun Gedebage", "code": "GDB", "lng": 107.6974, "lat": -6.9482},
    {"name": "Stasiun Cimekar", "code": "CMK", "lng": 107.7214, "lat": -6.9535},
    {"name": "Stasiun Rancaekek", "code": "RCK", "lng": 107.7552, "lat": -6.9634},
    {"name": "Stasiun Haurpugur", "code": "HRP", "lng": 107.8012, "lat": -6.9741},
    {"name": "Stasiun Cicalengka", "code": "CCL", "lng": 107.8385, "lat": -6.9812},
]

print(f"Station count: {len(stations)}")
# Test connecting to Overpass
try:
    overpass_url = "https://overpass-api.de/api/interpreter"
    query = """
    [out:json][timeout:25];
    way["railway"="rail"]["usage"="main"](-7.02,107.45,-6.82,107.86);
    out geom;
    """
    resp = httpx.post(overpass_url, data={"data": query}, timeout=10.0)
    print("Overpass status:", resp.status_code)
    data = resp.json()
    elements = data.get("elements", [])
    print("Railway elements:", len(elements))
except Exception as e:
    print("Overpass exception:", e)
