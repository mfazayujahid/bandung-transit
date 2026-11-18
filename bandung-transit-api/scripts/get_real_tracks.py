import httpx
import json

headers = {"User-Agent": "BandungTransitAgent/1.0 (contact: admin@bandungtransit.local)"}

# Query exact coordinates for the 13 stations from Nominatim or Overpass
stations = [
    "Stasiun Padalarang",
    "Stasiun Gadobangkong",
    "Stasiun Cimahi",
    "Stasiun Cimindi",
    "Stasiun Ciroyom",
    "Stasiun Bandung",
    "Stasiun Cikudapateuh",
    "Stasiun Kiaracondong",
    "Stasiun Gedebage",
    "Stasiun Cimekar",
    "Stasiun Rancaekek",
    "Stasiun Haurpugur",
    "Stasiun Cicalengka",
]

results = []
for name in stations:
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={name.replace(' ', '+')}+Bandung&format=json&limit=1"
        resp = httpx.get(url, headers=headers, timeout=10.0)
        data = resp.json()
        if data:
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            results.append({"name": name, "lat": lat, "lon": lon, "display": data[0]["display_name"]})
            print(f"{name}: [{lon}, {lat}]")
        else:
            print(f"{name}: Not found")
    except Exception as e:
        print(f"Error {name}:", e)

print("\nDone searching stations.")
