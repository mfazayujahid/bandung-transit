import httpx
import json

headers = {
    "User-Agent": "BandungTransitApp/1.0 (contact: admin@bandungtransit.local)",
    "Content-Type": "application/x-www-form-urlencoded"
}

query = """[out:json][timeout:25];
(
  way["railway"="rail"](-7.02,107.45,-6.82,107.86);
);
out geom;"""

endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
]

for ep in endpoints:
    try:
        print(f"Trying {ep}...")
        resp = httpx.post(ep, data={"data": query}, headers=headers, timeout=20.0)
        print("Status:", resp.status_code)
        if resp.status_code == 200:
            data = resp.json()
            elements = data.get("elements", [])
            print(f"Found {len(elements)} railway segments.")
            with open("railway_segments.json", "w") as f:
                json.dump(elements, f)
            print("Successfully saved railway_segments.json")
            break
    except Exception as e:
        print("Failed:", e)
