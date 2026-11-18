import httpx
import json

base_url = "http://localhost:8000"

print("--- 1. Testing GET /api/transit/trains ---")
r_trains = httpx.get(f"{base_url}/api/transit/trains")
print(f"Status: {r_trains.status_code}")
trains_data = r_trains.json()
features = trains_data.get("features", [])
print(f"Active trains found: {len(features)}")
for f in features:
    props = f.get("properties", {})
    geom = f.get("geometry", {})
    print(f"  Train {props.get('train_number')} toward {props.get('toward')} at {geom.get('coordinates')} | Speed: {props.get('speed_kmh')} km/h | Next: {props.get('next_station')} ({props.get('eta_next_station_minutes')} min)")

print("\n--- 2. Testing GET /api/transit/stops for Stations ---")
r_stops = httpx.get(f"{base_url}/api/transit/stops")
stops_data = r_stops.json()
stations = [s for s in stops_data.get("features", []) if s.get("properties", {}).get("category") == "Station"]
print(f"Stations found: {len(stations)}")
for s in stations[:5]:
    props = s.get("properties", {})
    print(f"  {props.get('name')} (Corridor: {props.get('corridor_name')})")

print("\n--- 3. Testing Multimodal Routing: Stasiun Cimahi -> Simpang Dago ---")
# Cimahi: 107.5422, -6.8845; Simpang Dago: 107.6163, -6.8856
params = {
    "origin_lng": 107.5422,
    "origin_lat": -6.8845,
    "dest_lng": 107.6163,
    "dest_lat": -6.8856,
}
r_plan = httpx.get(f"{base_url}/api/routing/plan", params=params)
print(f"Plan status: {r_plan.status_code}")
plan = r_plan.json()
if "legs" in plan:
    print(f"Total Duration: {plan.get('total_duration_minutes')} minutes")
    print(f"Leg count: {len(plan['legs'])}")
    for idx, leg in enumerate(plan["legs"], 1):
        l_type = leg.get("type")
        if l_type == "WALK" or l_type == "TRANSFER_WALK":
            print(f"  Leg {idx}: {l_type} - {leg.get('instruction')} ({leg.get('duration_seconds')}s)")
        else:
            inc = leg.get("incoming_bus", {})
            print(f"  Leg {idx}: {l_type} [{leg.get('corridor_code')}] {leg.get('corridor_name')} from {leg.get('board_stop')} to {leg.get('alight_stop')} | Live: {inc.get('bus_name')} (ETA {inc.get('eta_seconds')}s)")
else:
    print("Plan response:", plan)
