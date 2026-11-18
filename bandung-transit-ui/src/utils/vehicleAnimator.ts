import type { Feature } from 'geojson';
import type { TripPlan } from '../types/transit';

export interface AnimatedVehicle {
    id: string;
    kind: 'bus' | 'train';
    fromLng: number;
    fromLat: number;
    toLng: number;
    toLat: number;
    currLng: number;
    currLat: number;
    startTime: number;
    durationMs: number;
    lastPacketTs: number;
    moving: boolean;
    properties: Record<string, any>;
}

const MAX_GLIDE_JUMP_DEG = 0.015; // ~1.6 km — larger jumps snap instantly (e.g. GPS reset)
const MIN_MOVE_DEG = 0.000003;    // ~0.3m — sub-meter jitter snaps without animating
const STALE_BUS_MS = 10 * 60 * 1000; // 10 minutes

export class VehicleAnimator {
    private buses = new Map<string, AnimatedVehicle>();
    private trains = new Map<string, AnimatedVehicle>();
    private dirty = false;

    /**
     * Ingests a full snapshot or delta of bus GeoJSON features and updates smooth glide targets.
     */
    upsertBuses(features: any[], isSnapshot: boolean, now: number): void {
        const seen = isSnapshot ? new Set<string>() : null;

        for (const f of features) {
            const coords = f?.geometry?.coordinates;
            const props = f?.properties || {};
            const id = String(props.bus_id || '');
            if (!id || !Array.isArray(coords) || coords.length < 2) continue;

            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

            if (seen) seen.add(id);

            const existing = this.buses.get(id);
            if (!existing) {
                this.buses.set(id, {
                    id,
                    kind: 'bus',
                    fromLng: lng,
                    fromLat: lat,
                    toLng: lng,
                    toLat: lat,
                    currLng: lng,
                    currLat: lat,
                    startTime: now,
                    durationMs: 0,
                    lastPacketTs: now,
                    moving: false,
                    properties: props,
                });
                this.dirty = true;
            } else {
                // Capture current interpolated position so transition has zero teleport/jump
                this.advanceSingle(existing, now);

                const dLng = lng - existing.currLng;
                const dLat = lat - existing.currLat;
                const distDeg = Math.hypot(dLng, dLat);

                const dt = now - existing.lastPacketTs;
                existing.lastPacketTs = now;
                existing.properties = { ...existing.properties, ...props };

                if (distDeg < MIN_MOVE_DEG || distDeg > MAX_GLIDE_JUMP_DEG) {
                    existing.fromLng = lng;
                    existing.fromLat = lat;
                    existing.toLng = lng;
                    existing.toLat = lat;
                    existing.currLng = lng;
                    existing.currLat = lat;
                    existing.startTime = now;
                    existing.durationMs = 0;
                    existing.moving = false;
                } else {
                    // Adaptive glide duration matches the bus's real GPS cadence for continuous motion
                    const adaptiveMs = dt > 250 && dt < 15000 ? dt * 1.08 : 2200;
                    existing.fromLng = existing.currLng;
                    existing.fromLat = existing.currLat;
                    existing.toLng = lng;
                    existing.toLat = lat;
                    existing.startTime = now;
                    existing.durationMs = Math.max(850, Math.min(4500, adaptiveMs));
                    existing.moving = true;
                }
                this.dirty = true;
            }
        }

        if (seen) {
            for (const id of Array.from(this.buses.keys())) {
                if (!seen.has(id)) {
                    this.buses.delete(id);
                    this.dirty = true;
                }
            }
        }
    }

    /**
     * Ingests a 1-second GAPEKA train snapshot and sets smooth 1.05s glide targets.
     */
    upsertTrains(features: any[], now: number): void {
        const seen = new Set<string>();

        for (const f of features) {
            const coords = f?.geometry?.coordinates;
            const props = f?.properties || {};
            const id = String(props.train_id || props.train_number || '');
            if (!id || !Array.isArray(coords) || coords.length < 2) continue;

            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

            seen.add(id);
            const existing = this.trains.get(id);
            if (!existing) {
                this.trains.set(id, {
                    id,
                    kind: 'train',
                    fromLng: lng,
                    fromLat: lat,
                    toLng: lng,
                    toLat: lat,
                    currLng: lng,
                    currLat: lat,
                    startTime: now,
                    durationMs: 0,
                    lastPacketTs: now,
                    moving: false,
                    properties: props,
                });
                this.dirty = true;
            } else {
                this.advanceSingle(existing, now);
                const distDeg = Math.hypot(lng - existing.currLng, lat - existing.currLat);
                existing.lastPacketTs = now;
                existing.properties = { ...existing.properties, ...props };

                if (distDeg < MIN_MOVE_DEG || distDeg > MAX_GLIDE_JUMP_DEG) {
                    existing.fromLng = lng;
                    existing.fromLat = lat;
                    existing.toLng = lng;
                    existing.toLat = lat;
                    existing.currLng = lng;
                    existing.currLat = lat;
                    existing.startTime = now;
                    existing.durationMs = 0;
                    existing.moving = false;
                } else {
                    existing.fromLng = existing.currLng;
                    existing.fromLat = existing.currLat;
                    existing.toLng = lng;
                    existing.toLat = lat;
                    existing.startTime = now;
                    existing.durationMs = 1050; // Synced to 1.0s backend train_tick for silky motion
                    existing.moving = true;
                }
                this.dirty = true;
            }
        }

        for (const id of Array.from(this.trains.keys())) {
            if (!seen.has(id)) {
                this.trains.delete(id);
                this.dirty = true;
            }
        }
    }

    markDirty(): void {
        this.dirty = true;
    }

    private advanceSingle(v: AnimatedVehicle, now: number): boolean {
        if (!v.moving || v.durationMs <= 0) {
            return false;
        }
        const elapsed = now - v.startTime;
        const rawT = Math.max(0, Math.min(1, elapsed / v.durationMs));
        // Smooth linear-dominant glide with gentle ease-out only on the final 15%
        // so moving vehicles keep constant realistic cruising speed across packets
        const t = rawT < 0.85 ? rawT : 0.85 + 0.15 * (1 - Math.pow(1 - (rawT - 0.85) / 0.15, 2));

        v.currLng = v.fromLng + (v.toLng - v.fromLng) * t;
        v.currLat = v.fromLat + (v.toLat - v.fromLat) * t;

        if (rawT >= 1) {
            v.currLng = v.toLng;
            v.currLat = v.toLat;
            v.moving = false;
        }
        return true;
    }

    /**
     * Advances all animated vehicles to `now`. Returns true if any vehicle moved or state changed.
     */
    step(now: number): boolean {
        let changed = this.dirty;
        this.dirty = false;

        for (const [id, v] of this.buses) {
            if (now - v.lastPacketTs > STALE_BUS_MS) {
                this.buses.delete(id);
                changed = true;
                continue;
            }
            if (this.advanceSingle(v, now)) {
                changed = true;
            }
        }

        for (const v of this.trains.values()) {
            if (this.advanceSingle(v, now)) {
                changed = true;
            }
        }

        return changed;
    }

    private resolveBusIconName(corridorCode: string): string {
        const clean = corridorCode.toUpperCase().trim().replace(/D$/, '');
        if (['FD-1', 'FD-2', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6'].includes(clean)) {
            return `bus-puck-${clean}`;
        }
        return 'bus-puck-default';
    }

    /**
     * Builds current-frame GeoJSON feature arrays for MapLibre GL sources.
     */
    buildFrame(trip: TripPlan | null): {
        busFeatures: Feature[];
        trainFeatures: Feature[];
        incomingFeatures: Feature[];
    } {
        const relevantBusCorridors = trip
            ? trip.legs
                  .filter((l) => l.type === 'BUS')
                  .map((l) => (l.corridor_code || '').toUpperCase().trim())
                  .filter(Boolean)
            : [];
        const hasTrainLeg = Boolean(trip?.legs.some((l) => l.type === 'TRAIN'));

        const busFeatures: Feature[] = [];
        const trainFeatures: Feature[] = [];
        const incomingFeatures: Feature[] = [];

        for (const v of this.buses.values()) {
            const props = v.properties;
            const busId = String(props.bus_id || '');
            const busName = String(props.bus_name || '');
            const kor = String(props.corridor_code || '').toUpperCase().trim();

            const isTarget = Boolean(
                trip?.legs.some(
                    (l) =>
                        (l.incoming_bus?.bus_id && String(l.incoming_bus.bus_id) === busId) ||
                        (l.incoming_bus?.bus_name && l.incoming_bus.bus_name === busName)
                )
            );

            const onCorridor =
                !trip ||
                isTarget ||
                relevantBusCorridors.some(
                    (c) =>
                        kor === c ||
                        kor.startsWith(c) ||
                        c.startsWith(kor) ||
                        busName.toUpperCase().includes(c)
                );

            const feat: Feature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [v.currLng, v.currLat],
                },
                properties: {
                    ...props,
                    icon_name: this.resolveBusIconName(kor),
                    is_target: isTarget ? 1 : 0,
                    on_trip_corridor: onCorridor ? 1 : 0,
                    label: isTarget ? `🟢 Bus Anda (${busName || 'MJT'})` : busName,
                },
            };

            busFeatures.push(feat);
            if (isTarget) {
                incomingFeatures.push(feat);
            }
        }

        for (const v of this.trains.values()) {
            const props = v.properties;
            const num = String(props.train_number || 'KA');
            const toward = props.toward || '';
            const speed = typeof props.speed_kmh === 'number' ? props.speed_kmh : 50;
            const isBoarding = props.status === 'BOARDING' || speed <= 0.5;
            const shortStation = String(props.current_station || '').replace(/^Stasiun\s+/i, '');

            const isTarget = Boolean(
                trip?.legs.some(
                    (l) =>
                        l.type === 'TRAIN' &&
                        l.incoming_vehicle?.train_number &&
                        String(l.incoming_vehicle.train_number) === num
                )
            );

            const onCorridor = !trip || isTarget || hasTrainLeg;

            let label: string;
            if (isTarget) {
                label = isBoarding
                    ? `🟢 Kereta Anda (${num} · Berhenti di ${shortStation || 'Stasiun'})`
                    : `🟢 Kereta Anda (${num} · ${Math.round(speed)} km/h)`;
            } else {
                label = isBoarding
                    ? `🚉 ${num} · Berhenti di ${shortStation || 'Stasiun'}`
                    : `🚆 ${num} (${Math.round(speed)} km/h ➔ ${toward})`;
            }

            const feat: Feature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [v.currLng, v.currLat],
                },
                properties: {
                    ...props,
                    is_target: isTarget ? 1 : 0,
                    on_trip_corridor: onCorridor ? 1 : 0,
                    label,
                },
            };

            trainFeatures.push(feat);
            if (isTarget) {
                incomingFeatures.push(feat);
            }
        }

        return { busFeatures, trainFeatures, incomingFeatures };
    }
}
