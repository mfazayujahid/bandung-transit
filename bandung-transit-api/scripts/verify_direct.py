from app.db.session import sessionLocal
from app.services.train_telemetry import get_active_trains, estimate_next_train
from app.services.router import plan_trip
from app.models.transit import Corridor, Stop

print("--- 1. Testing get_active_trains() ---")
trains = get_active_trains()
print(f"Active trains: {len(trains)}")
for t in trains:
    print(f"  {t['train_number']} toward {t['toward']} | Coords: {t['coordinates']} | Speed: {t['speed_kmh']} km/h | Next: {t['next_station']}")

print("\n--- 2. Testing estimate_next_train() ---")
next_train = estimate_next_train("Cicalengka", "Stasiun Bandung")
print(f"Next train at Stasiun Bandung toward Cicalengka: {next_train}")

print("\n--- 3. Testing Multimodal Dijkstra (Stasiun Cimahi -> Simpang Dago) ---")
db = sessionLocal()
try:
    # Stasiun Cimahi: 107.5422, -6.8845
    # Simpang Dago: 107.6163, -6.8856
    plan = plan_trip(db, 107.5422, -6.8845, 107.6163, -6.8856)
    if "error" in plan:
        print("Plan error:", plan["error"])
    else:
        print(f"Total duration: {plan['total_duration_minutes']} min")
        print(f"Total legs: {len(plan['legs'])}")
        for i, leg in enumerate(plan['legs'], 1):
            l_type = leg['type']
            if l_type in ("WALK", "TRANSFER_WALK"):
                print(f"  Leg {i}: {l_type} - {leg.get('instruction')} ({leg.get('duration_seconds')}s)")
            else:
                inc = leg.get('incoming_bus', {})
                print(f"  Leg {i}: {l_type} [{leg.get('corridor_code')}] {leg.get('corridor_name')} ({leg.get('board_stop')} -> {leg.get('alight_stop')}) | Vehicle: {inc.get('bus_name')} (ETA: {inc.get('eta_seconds')}s)")
finally:
    db.close()
