from app.services.train_telemetry import get_active_trains, estimate_next_train

trains = get_active_trains()
print("Active trains count:", len(trains))
for t in trains:
    print(f"- {t['train_number']} toward {t['toward']} at {t['coordinates']} ({t['speed_kmh']} km/h)")
