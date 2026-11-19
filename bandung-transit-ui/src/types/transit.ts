import type { LineString } from 'geojson';

export type SnapState = 'COLLAPSED' | 'HALF' | 'FULL';

export type InputMode = 'ORIGIN' | 'DEST';

export interface LocationPoint {
    coords: [number, number]; // [lng, lat] strictly
    name: string;
    description?: string;
    isPreset?: boolean;
}

export interface TrainScheduleItem {
    train_number: string;
    departure_time: string;
    scheduled_arrival?: string | null;
    eta_minutes: number;
    status: 'BOARDING' | 'MOVING' | 'SCHEDULED' | string;
    current_station?: string | null;
}

export interface UpcomingBusItem {
    bus_id: string;
    bus_name: string;
    plate_number: string | null;
    departure_time: string;
    wait_minutes: number;
    eta_minutes: number;
    direct_upstream: boolean;
}

export interface IncomingBus {
    bus_id: string | null;
    bus_name: string;
    plate_number: string | null;
    meter_away?: number | null;
    meters_away?: number | null;
    eta_seconds: number;
    wait_seconds?: number;
    passenger_arrival_time?: string | null;
    match_type?: 'LIVE_CATCHABLE' | 'LIVE_LOOP_SYNCED' | 'ESTIMATED_FUTURE' | string;
    is_train?: boolean;
    train_number?: string;
    departure_time?: string | null;
    scheduled_arrival?: string | null;
    status?: 'BOARDING' | 'MOVING' | 'SCHEDULED' | string;
    current_station?: string | null;
    next_station?: string | null;
    approach_geometry?: LineString | null;
    upcoming_schedule?: TrainScheduleItem[];
    upcoming_buses?: UpcomingBusItem[];
}

export interface FareBreakdownItem {
    name: string;
    type: 'BUS' | 'TRAIN';
    fare_idr: number;
    fare_formatted: string;
    operator: string;
    payment_methods?: string[];
}

export interface FareInfo {
    total_fare_idr: number;
    total_fare_formatted: string;
    discounted_fare_idr?: number;
    discounted_fare_formatted?: string;
    fare_breakdown: FareBreakdownItem[];
    payment_summary?: string;
    note?: string;
}

export interface TripLeg {
    type: 'WALK' | 'TRANSFER_WALK' | 'BUS' | 'TRAIN';
    instruction?: string;
    corridor_id?: number;
    corridor_code?: string;
    corridor_name?: string;
    toward?: string;
    color?: string;
    board_stop?: string;
    alight_stop?: string;
    stop_count?: number;
    stop_coords?: [number, number][];
    duration_seconds: number;
    distance_meters?: number;
    from_coords?: [number, number];
    to_coords?: [number, number];
    geometry?: LineString;
    incoming_bus?: IncomingBus;
    incoming_vehicle?: IncomingBus;
    fare_idr?: number;
    fare_formatted?: string;
    operator?: string;
    payment_methods?: string[];
}

export interface TripPlan {
    total_duration_minutes: number;
    total_duration_seconds?: number;
    total_fare_idr?: number;
    total_fare_formatted?: string;
    fare?: FareInfo;
    legs: TripLeg[];
}

/**
 * Helper to retrieve robust fare information with graceful client-side fallback.
 */
export function getTripFareInfo(trip: TripPlan | null | undefined): {
    amount: number;
    formatted: string;
    discountedAmount?: number;
    discountedFormatted?: string;
    breakdown: FareBreakdownItem[];
    paymentSummary: string;
    note?: string;
} {
    if (!trip) {
        return {
            amount: 0,
            formatted: 'Rp 0',
            breakdown: [],
            paymentSummary: 'Non-tunai',
        };
    }
    if (trip.fare && trip.fare.total_fare_formatted) {
        return {
            amount: trip.fare.total_fare_idr || 0,
            formatted: trip.fare.total_fare_formatted,
            discountedAmount: trip.fare.discounted_fare_idr,
            discountedFormatted: trip.fare.discounted_fare_formatted,
            breakdown: trip.fare.fare_breakdown || [],
            paymentSummary: trip.fare.payment_summary || 'Non-tunai (QRIS / Uang Elektronik)',
            note: trip.fare.note,
        };
    }
    if (trip.total_fare_formatted && trip.total_fare_idr !== undefined) {
        return {
            amount: trip.total_fare_idr,
            formatted: trip.total_fare_formatted,
            breakdown: [],
            paymentSummary: 'Non-tunai (QRIS / Uang Elektronik)',
        };
    }

    // Client-side fallback calculation from legs
    let total = 0;
    let discTotal = 0;
    const breakdown: FareBreakdownItem[] = [];
    for (const leg of trip.legs || []) {
        if (leg.type === 'TRAIN') {
            const f = leg.fare_idr ?? 5000;
            total += f;
            discTotal += 5000;
            breakdown.push({
                name: leg.corridor_name || 'Commuter Line Bandung Raya',
                type: 'TRAIN',
                fare_idr: f,
                fare_formatted: `Rp ${f.toLocaleString('id-ID')}`,
                operator: 'KAI Commuter',
                payment_methods: leg.payment_methods || ['KMT', 'E-Money', 'Access by KAI'],
            });
        } else if (leg.type === 'BUS') {
            const f = leg.fare_idr ?? 4900;
            total += f;
            discTotal += 2000;
            breakdown.push({
                name: `Bus ${leg.corridor_code || ''} (${leg.corridor_name || ''})`,
                type: 'BUS',
                fare_idr: f,
                fare_formatted: `Rp ${f.toLocaleString('id-ID')}`,
                operator: 'Metro Jabar Trans / Teman Bus',
                payment_methods: leg.payment_methods || ['QRIS', 'E-Money'],
            });
        }
    }

    const formatted = total === 0 ? 'Gratis' : `Rp ${total.toLocaleString('id-ID')}`;
    const discFormatted = discTotal === 0 ? undefined : `Rp ${discTotal.toLocaleString('id-ID')}`;

    return {
        amount: total,
        formatted,
        discountedAmount: discTotal,
        discountedFormatted: discFormatted,
        breakdown,
        paymentSummary: 'Non-tunai (QRIS / Uang Elektronik / KMT)',
        note: 'Tarif bus MJT Rp 4.900 (Rp 2.000 tarif khusus pelajar/lansia); Kereta Commuter Line Rp 5.000 (PSO).',
    };
}

export interface LiveBusFeature {
    type: 'Feature';
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
    properties: {
        bus_id: string;
        bus_name: string;
        plate_number: string;
        speed_kmh: number;
        bearing: number;
        corridor_code: string;
        corridor_color: string;
        toward: string;
    };
}

export interface LiveTrainFeature {
    type: 'Feature';
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
    properties: {
        train_id: string;
        train_number: string;
        corridor_code: string;
        corridor_name: string;
        toward: string;
        origin: string;
        destination: string;
        color: string;
        bearing: number;
        speed_kmh: number;
        progress_percent: number;
        next_station: string;
        eta_next_station_minutes: number;
    };
}

export interface NavigationState {
    isNavigating: boolean;
    currentLegIndex: number;
    userLocation: [number, number] | null;
    userBearing: number;
    isSimulating: boolean;
    remainingMinutes: number;
    remainingDistanceMeters: number;
    etaTimeString: string;
}
