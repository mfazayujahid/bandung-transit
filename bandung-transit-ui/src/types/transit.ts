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
}

export interface TripPlan {
    total_duration_minutes: number;
    legs: TripLeg[];
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
