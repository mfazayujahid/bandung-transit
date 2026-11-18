import httpx
import json

# Overpass GET request
query = """[out:json][timeout:25];
way["railway"="rail"]["usage"="main"](-7.02,107.45,-6.82,107.86);
out geom;"""

url = "https://overpass-api.de/api/interpreter"
params = {"data": query}
headers = {"User-Agent": "Mozilla/5.0"}

print("Sending Overpass GET...")
r = httpx.get(url, params=params, headers=headers, timeout=25.0)
print("Status:", r.status_code)
if r.status_code == 200:
    data = r.json()
    elements = data.get("elements", [])
    print("Found elements:", len(elements))
    with open("rail_overpass.json", "w") as f:
        json.dump(elements, f)
    print("Saved rail_overpass.json!")
else:
    print("Response text:", r.text[:200])
