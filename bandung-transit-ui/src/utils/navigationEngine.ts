import type { TripLeg } from '../types/transit';

const EARTH_RADIUS_M = 6371000;

/**
 * Great-circle Haversine distance in meters between two GeoJSON coordinates [lng, lat].
 */
export function haversineMeters(a: [number, number], b: [number, number]): number {
    const [lng1, lat1] = a;
    const [lng2, lat2] = b;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const rLat1 = (lat1 * Math.PI) / 180;
    const rLat2 = (lat2 * Math.PI) / 180;

    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(rLat1) * Math.cos(rLat2) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * Initial compass bearing (0..360 deg, clockwise from North) between two [lng, lat] points.
 */
export function calculateBearing(start: [number, number], end: [number, number]): number {
    const startLat = (start[1] * Math.PI) / 180;
    const startLng = (start[0] * Math.PI) / 180;
    const endLat = (end[1] * Math.PI) / 180;
    const endLng = (end[0] * Math.PI) / 180;

    const y = Math.sin(endLng - startLng) * Math.cos(endLat);
    const x =
        Math.cos(startLat) * Math.sin(endLat) -
        Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
}

/**
 * Extract ordered [lng, lat] polyline coordinates for a trip leg.
 */
export function getLegCoordinates(leg: TripLeg | undefined): [number, number][] {
    if (!leg) return [];
    if (leg.geometry && leg.geometry.coordinates && leg.geometry.coordinates.length > 0) {
        return leg.geometry.coordinates as [number, number][];
    }
    if (leg.stop_coords && leg.stop_coords.length > 0) {
        return leg.stop_coords;
    }
    if (leg.from_coords && leg.to_coords) {
        return [leg.from_coords, leg.to_coords];
    }
    return [];
}

export interface PolylineProjection {
    /** Closest perpendicular/endpoint distance from user to the leg polyline (meters). */
    distanceMeters: number;
    /** Total geometric length of the leg polyline (meters). */
    totalLegMeters: number;
    /** Remaining distance along the polyline from snapped user point to the leg's end (meters). */
    remainingAlongLegMeters: number;
    /** Normalized progress along the leg (0.0 .. 1.0). */
    progressRatio: number;
}

/**
 * Project a [lng, lat] point onto a GeoJSON polyline using local equirectangular approximation
 * (sub-meter accuracy at Bandung city scale).
 */
export function projectOntoPolyline(
    point: [number, number],
    coords: [number, number][]
): PolylineProjection {
    if (coords.length === 0) {
        return {
            distanceMeters: 0,
            totalLegMeters: 0,
            remainingAlongLegMeters: 0,
            progressRatio: 0,
        };
    }
    if (coords.length === 1) {
        const d = haversineMeters(point, coords[0]);
        return {
            distanceMeters: d,
            totalLegMeters: 0,
            remainingAlongLegMeters: d,
            progressRatio: 1,
        };
    }

    const refLatRad = (point[1] * Math.PI) / 180;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(refLatRad);

    const toXY = (c: [number, number]): [number, number] => [
        (c[0] - point[0]) * mPerDegLng,
        (c[1] - point[1]) * mPerDegLat,
    ];

    const segLengths: number[] = [];
    let totalLegMeters = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const len = haversineMeters(coords[i], coords[i + 1]);
        segLengths.push(len);
        totalLegMeters += len;
    }

    let bestDistSq = Infinity;
    let bestSegIdx = 0;
    let bestT = 0;

    for (let i = 0; i < coords.length - 1; i++) {
        const [ax, ay] = toXY(coords[i]);
        const [bx, by] = toXY(coords[i + 1]);
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;

        let t = 0;
        if (lenSq > 1e-6) {
            // Point is at (0, 0) in local frame
            t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
        }

        const px = ax + t * dx;
        const py = ay + t * dy;
        const distSq = px * px + py * py;
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestSegIdx = i;
            bestT = t;
        }
    }

    let remainingAlongLegMeters = (1 - bestT) * segLengths[bestSegIdx];
    for (let i = bestSegIdx + 1; i < segLengths.length; i++) {
        remainingAlongLegMeters += segLengths[i];
    }

    const progressRatio =
        totalLegMeters > 1 ? Math.max(0, Math.min(1, 1 - remainingAlongLegMeters / totalLegMeters)) : 1;

    return {
        distanceMeters: Math.sqrt(bestDistSq),
        totalLegMeters,
        remainingAlongLegMeters,
        progressRatio,
    };
}

export interface NavigationProgress {
    shouldAdvanceLeg: boolean;
    arrivedAtDestination: boolean;
    remainingLegMeters: number;
    remainingTotalMeters: number;
    remainingTotalMinutes: number;
    offRoute: boolean;
    distanceOffRouteMeters: number;
    approachingCheckpoint: boolean;
}

/**
 * Evaluate real-time GPS position against the active transit trip to compute:
 * - Auto leg progression (geofencing for walk checkpoints, bus/train alighting, final arrival)
 * - Live remaining distance & ETA
 * - Off-route detection
 * - "Approaching your alighting stop" alert
 */
export function evaluateNavigationProgress(
    userCoords: [number, number] | null,
    legs: TripLeg[],
    currentLegIndex: number,
    accuracyMeters: number | null
): NavigationProgress {
    if (!legs || legs.length === 0 || currentLegIndex >= legs.length) {
        return {
            shouldAdvanceLeg: false,
            arrivedAtDestination: legs.length > 0 && currentLegIndex >= legs.length,
            remainingLegMeters: 0,
            remainingTotalMeters: 0,
            remainingTotalMinutes: 0,
            offRoute: false,
            distanceOffRouteMeters: 0,
            approachingCheckpoint: false,
        };
    }

    const currentLeg = legs[currentLegIndex];
    const futureLegs = legs.slice(currentLegIndex + 1);
    const futureMeters = futureLegs.reduce((sum, l) => sum + (l.distance_meters || 400), 0);
    const futureSeconds = futureLegs.reduce((sum, l) => sum + (l.duration_seconds || 0), 0);

    const coords = getLegCoordinates(currentLeg);
    if (!userCoords || coords.length === 0) {
        const curMeters = currentLeg.distance_meters || 400;
        const totalSec = (currentLeg.duration_seconds || 0) + futureSeconds;
        return {
            shouldAdvanceLeg: false,
            arrivedAtDestination: false,
            remainingLegMeters: curMeters,
            remainingTotalMeters: curMeters + futureMeters,
            remainingTotalMinutes: Math.max(1, Math.round(totalSec / 60)),
            offRoute: false,
            distanceOffRouteMeters: 0,
            approachingCheckpoint: false,
        };
    }

    const projection = projectOntoPolyline(userCoords, coords);
    const legEnd = coords[coords.length - 1];
    const distToLegEnd = haversineMeters(userCoords, legEnd);

    const isTransitLeg = currentLeg.type === 'BUS' || currentLeg.type === 'TRAIN';
    const isFinalLeg = currentLegIndex === legs.length - 1;
    const accuracyMargin = accuracyMeters ? Math.min(25, Math.max(0, accuracyMeters * 0.4)) : 0;

    // Geofence arrival radii:
    // - Walking legs: 40m + small accuracy margin (clamped <= 60m)
    // - Bus/Train alighting: 110m (stations & BRT shelters are wide; trains move fast)
    const arrivalRadius = isTransitLeg
        ? 110
        : Math.min(60, 40 + accuracyMargin);

    // Prevent instant false skipping on transit legs where start & end might be relatively near
    const reachedLegEnd = isTransitLeg
        ? distToLegEnd <= arrivalRadius && (projection.progressRatio >= 0.6 || distToLegEnd <= 75)
        : distToLegEnd <= arrivalRadius;

    // Live remaining distance for current leg (use max of direct distance to end and along-leg remaining)
    const remainingLegMeters = Math.max(0, Math.round(projection.remainingAlongLegMeters));
    const plannedLegMeters = Math.max(1, projection.totalLegMeters || currentLeg.distance_meters || 400);
    const remainingFraction = Math.max(0, Math.min(1, remainingLegMeters / plannedLegMeters));
    const currentLegRemainingSec = (currentLeg.duration_seconds || 0) * remainingFraction;

    const remainingTotalMeters = Math.round(remainingLegMeters + futureMeters);
    const remainingTotalMinutes = Math.max(
        1,
        Math.round((currentLegRemainingSec + futureSeconds) / 60)
    );

    // Off-route threshold: 90m walking, 300m in-vehicle (plus bounded accuracy allowance)
    const offRouteThreshold = (isTransitLeg ? 300 : 90) + accuracyMargin;
    const offRoute = projection.distanceMeters > offRouteThreshold;

    // Approaching alighting stop alert for Bus/Train (within 300m of alighting stop and not yet arrived)
    const approachingCheckpoint =
        isTransitLeg && !reachedLegEnd && distToLegEnd <= 300 && projection.progressRatio >= 0.5;

    return {
        shouldAdvanceLeg: reachedLegEnd && !isFinalLeg,
        arrivedAtDestination: reachedLegEnd && isFinalLeg,
        remainingLegMeters,
        remainingTotalMeters,
        remainingTotalMinutes,
        offRoute,
        distanceOffRouteMeters: Math.round(projection.distanceMeters),
        approachingCheckpoint,
    };
}
