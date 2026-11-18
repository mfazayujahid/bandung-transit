import React from 'react';
import {
    Bus,
    Train,
    Clock,
    Footprints,
    MapPin,
    Radio,
} from 'lucide-react';
import { CORRIDOR_BRAND_COLORS } from '../constants/bandungLandmarks';
import type { LocationPoint, TripLeg } from '../types/transit';

interface TripTimelineProps {
    origin: LocationPoint | null;
    destination: LocationPoint | null;
    legs: TripLeg[];
    totalMinutes: number;
}

export const TripTimeline: React.FC<TripTimelineProps> = ({
    origin,
    destination,
    legs,
    totalMinutes,
}) => {
    return (
        <div className="flex flex-col gap-3 py-1">
            {/* Quick Trip Header Overview */}
            <div className="bg-slate-100/90 rounded-xl p-3 flex items-center justify-between border border-slate-200">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-600 text-white rounded-lg shadow-sm">
                        <Clock className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="text-xs font-medium text-slate-500">Estimated Travel Time</div>
                        <div className="text-xl font-black text-slate-900 tracking-tight">
                            {totalMinutes} <span className="text-sm font-semibold text-slate-600">min</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {legs
                        .filter((leg) => leg.type === 'BUS' || leg.type === 'TRAIN')
                        .map((leg, idx) => {
                            const isTrain = leg.type === 'TRAIN';
                            const corridorKey = leg.corridor_code || (isTrain ? 'CLR' : 'K1D');
                            const brand = CORRIDOR_BRAND_COLORS[corridorKey] || {
                                color: leg.color || (isTrain ? '#1e3a8a' : '#2563eb'),
                                badgeText: corridorKey,
                            };
                            return (
                                <span
                                    key={idx}
                                    style={{ backgroundColor: brand.color }}
                                    className="px-2 py-0.5 rounded text-white text-[11px] font-bold shadow-xs flex items-center gap-1"
                                >
                                    {isTrain ? <Train className="w-3 h-3" /> : <Bus className="w-3 h-3" />}
                                    {brand.badgeText}
                                </span>
                            );
                        })}
                </div>
            </div>

            {/* Timeline Steps Container */}
            <div className="relative pl-6 pr-1 space-y-4 before:absolute before:left-[11px] before:top-2 before:bottom-3 before:w-[2px] before:bg-slate-200">
                {/* 1. Origin Node */}
                <div className="relative">
                    <div className="absolute -left-[23px] top-0.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white ring-4 ring-white shadow-sm">
                        <div className="w-2 h-2 rounded-full bg-white" />
                    </div>
                    <div>
                        <span className="text-[10px] font-bold tracking-wider text-emerald-600 uppercase">
                            Pickup (Point A)
                        </span>
                        <h4 className="text-xs font-bold text-slate-800 leading-snug">
                            {origin ? origin.name : 'Selected Pickup Location'}
                        </h4>
                    </div>
                </div>

                {/* 2. Legs (Walking, Bus, Train, Transfer) */}
                {legs.map((leg, idx) => {
                    if (leg.type === 'WALK' || leg.type === 'TRANSFER_WALK') {
                        const isTransfer = leg.type === 'TRANSFER_WALK';
                        const walkDurationMin = Math.max(1, Math.round(leg.duration_seconds / 60));

                        return (
                            <div key={idx} className="relative">
                                <div className="absolute -left-[21px] top-0.5 w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center text-slate-700 ring-4 ring-white">
                                    <Footprints className="w-2.5 h-2.5" />
                                </div>
                                <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2.5">
                                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                                        <span className="flex items-center gap-1.5">
                                            {isTransfer ? 'Transfer Walk' : 'Walk to Station / Stop'}
                                        </span>
                                        <span className="text-slate-500 font-normal">
                                            {walkDurationMin} min ({leg.distance_meters ? `${Math.round(leg.distance_meters)}m` : 'nearby'})
                                        </span>
                                    </div>
                                    {leg.instruction && (
                                        <p className="text-[11px] text-slate-500 mt-0.5">{leg.instruction}</p>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    // Bus or Train Transit Leg
                    const isTrain = leg.type === 'TRAIN';
                    const corridorKey = leg.corridor_code || (isTrain ? 'CLR' : 'K1D');
                    const brand = CORRIDOR_BRAND_COLORS[corridorKey] || {
                        color: leg.color || (isTrain ? '#1e3a8a' : '#2563eb'),
                        badgeText: corridorKey,
                        name: leg.corridor_name || (isTrain ? 'Commuter Line Bandung Raya' : 'Corridor'),
                    };
                    const transitDurationMin = Math.max(1, Math.round(leg.duration_seconds / 60));
                    const vehicle = leg.incoming_bus;

                    return (
                        <div key={idx} className="relative">
                            {/* Marker on Timeline */}
                            <div
                                style={{ backgroundColor: brand.color }}
                                className="absolute -left-[23px] top-1 w-5 h-5 rounded-full flex items-center justify-center text-white ring-4 ring-white shadow-sm"
                            >
                                {isTrain ? <Train className="w-3 h-3" /> : <Bus className="w-3 h-3" />}
                            </div>

                            {/* Transit Card */}
                            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-2.5">
                                {/* Corridor and Direction */}
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span
                                                style={{ backgroundColor: brand.color }}
                                                className="px-2 py-0.5 rounded text-white text-[11px] font-bold flex items-center gap-1"
                                            >
                                                {isTrain && <Train className="w-2.5 h-2.5" />}
                                                {brand.badgeText}
                                            </span>
                                            <span className="text-xs font-bold text-slate-800">
                                                {leg.corridor_name || brand.name}
                                            </span>
                                        </div>
                                        {leg.toward && (
                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                Arah: <strong className="text-slate-700">{leg.toward}</strong>
                                            </p>
                                        )}
                                    </div>

                                    <span className="text-xs font-semibold text-slate-600 shrink-0">
                                        ~{transitDurationMin} min
                                    </span>
                                </div>

                                {/* Boarding and Alighting Info */}
                                <div className="text-xs bg-slate-50 rounded-lg p-2 space-y-1.5 border border-slate-100">
                                    <div className="flex items-center gap-1.5 text-slate-800">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                        <span>Naik di: <strong>{leg.board_stop}</strong></span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-slate-800">
                                        <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                                        <span>Turun di: <strong>{leg.alight_stop}</strong></span>
                                    </div>
                                    {leg.stop_count && (
                                        <div className="text-[10px] text-slate-400 pl-3.5">
                                            Melewati {leg.stop_count} {isTrain ? 'stasiun' : 'halte'}
                                        </div>
                                    )}
                                </div>

                                {/* Live Vehicle Telemetry & Checkpoint-Synced Schedule Card (Train or Bus) */}
                                {vehicle && (() => {
                                    const isFutureBus = !isTrain && vehicle.match_type === 'ESTIMATED_FUTURE';
                                    const waitMin = Math.max(
                                        1,
                                        Math.round((vehicle.wait_seconds ?? vehicle.eta_seconds) / 60)
                                    );
                                    return (
                                    <div className={`rounded-lg p-2.5 border space-y-2 ${
                                        isTrain
                                            ? 'bg-orange-50/70 border-orange-200/90'
                                            : isFutureBus
                                            ? 'bg-slate-50 border-slate-200'
                                            : 'bg-emerald-50 border-emerald-200'
                                    }`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="relative flex items-center justify-center shrink-0">
                                                    {isFutureBus ? (
                                                        <Clock className="w-4 h-4 text-slate-500" />
                                                    ) : (
                                                        <Radio className={`w-4 h-4 animate-pulse-live ${
                                                            isTrain ? 'text-orange-600' : 'text-emerald-600'
                                                        }`} />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className={`text-[11px] font-bold flex items-center gap-1.5 flex-wrap ${
                                                        isTrain
                                                            ? 'text-orange-950'
                                                            : isFutureBus
                                                            ? 'text-slate-800'
                                                            : 'text-emerald-900'
                                                    }`}>
                                                        <span>
                                                            {isTrain
                                                                ? `🚆 Naik ${vehicle.train_number || vehicle.bus_name}`
                                                                : isFutureBus
                                                                ? `🚌 ${vehicle.bus_name}`
                                                                : `🚌 Live Bus: ${vehicle.bus_name}`}
                                                        </span>
                                                        {isTrain && vehicle.status === 'BOARDING' && (
                                                            <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                                                                Berhenti di Stasiun
                                                            </span>
                                                        )}
                                                        {vehicle.plate_number && !isTrain && (
                                                            <span className="text-[10px] bg-emerald-200/80 text-emerald-800 px-1 py-0.2 rounded font-mono font-medium">
                                                                {vehicle.plate_number}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {isTrain && vehicle.departure_time ? (
                                                        <p className="text-[11px] text-orange-900 font-semibold mt-0.5">
                                                            Berangkat <span className="font-black">{vehicle.departure_time}</span> dari {leg.board_stop}
                                                            {vehicle.scheduled_arrival && (
                                                                <span className="text-orange-700 font-normal"> · Tiba {vehicle.scheduled_arrival}</span>
                                                            )}
                                                        </p>
                                                    ) : isFutureBus ? (
                                                        <p className="text-[10.5px] text-slate-600 mt-0.5">
                                                            Tiba di halte <strong className="text-slate-800">~{vehicle.passenger_arrival_time}</strong>
                                                            {vehicle.departure_time && (
                                                                <> · Est. naik <strong className="text-slate-800">~{vehicle.departure_time}</strong></>
                                                            )}
                                                        </p>
                                                    ) : (
                                                        <p className="text-[10.5px] text-emerald-800 mt-0.5">
                                                            {vehicle.departure_time && (
                                                                <>Est. tiba halte <strong>{vehicle.departure_time}</strong> · </>
                                                            )}
                                                            {vehicle.meters_away || vehicle.meter_away
                                                                ? `${Math.round(((vehicle.meters_away || vehicle.meter_away) as number) / 100) / 10} km sebelum halte`
                                                                : 'Menuju halte Anda'}
                                                        </p>
                                                    )}

                                                    {isTrain && (
                                                        <p className="text-[10px] text-orange-700/90 mt-0.5">
                                                            {vehicle.passenger_arrival_time && (
                                                                <span>Anda tiba di stasiun ~{vehicle.passenger_arrival_time} · </span>
                                                            )}
                                                            {vehicle.status === 'BOARDING' && vehicle.current_station
                                                                ? `Kereta berhenti di ${vehicle.current_station} (naik/turun)`
                                                                : vehicle.meter_away !== null && vehicle.meter_away !== undefined && vehicle.meter_away > 0
                                                                ? `Posisi kereta ${Math.round((vehicle.meter_away as number) / 100) / 10} km sebelum ${leg.board_stop}`
                                                                : 'Sesuai jadwal GAPEKA KAI'}
                                                        </p>
                                                    )}
                                                    {!isTrain && !isFutureBus && vehicle.passenger_arrival_time && (
                                                        <p className="text-[9.5px] text-emerald-700/90 mt-0.5">
                                                            Anda tiba di halte ~{vehicle.passenger_arrival_time}
                                                            {vehicle.match_type === 'LIVE_LOOP_SYNCED'
                                                                ? ' · Armada dipilih sesuai ETA tiba Anda'
                                                                : ' · Langsung menuju halte Anda'}
                                                        </p>
                                                    )}
                                                    {isFutureBus && (
                                                        <p className="text-[9.5px] text-slate-500 mt-0.5">
                                                            Disinkronkan dengan ETA tiba Anda di halte
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="text-right shrink-0">
                                                <span className={`text-xs font-black ${
                                                    isTrain
                                                        ? 'text-orange-950'
                                                        : isFutureBus
                                                        ? 'text-slate-800'
                                                        : 'text-emerald-900'
                                                }`}>
                                                    ~{waitMin} min
                                                </span>
                                                <span className={`block text-[9px] uppercase font-bold tracking-wider ${
                                                    isTrain
                                                        ? 'text-orange-600'
                                                        : isFutureBus
                                                        ? 'text-slate-500'
                                                        : 'text-emerald-600'
                                                }`}>
                                                    Tunggu
                                                </span>
                                            </div>
                                        </div>

                                        {/* Upcoming Catchable Buses Strip (Synced to Checkpoint ETA) */}
                                        {!isTrain && vehicle.upcoming_buses && vehicle.upcoming_buses.length > 0 && (
                                            <div className="pt-1.5 border-t border-emerald-200/70">
                                                <div className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-800/80 mb-1">
                                                    Armada {leg.corridor_code} Berikutnya (Sesuai ETA)
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {vehicle.upcoming_buses.map((bItem, bIdx) => (
                                                        <span
                                                            key={bItem.bus_id + bIdx}
                                                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 ${
                                                                bIdx === 0
                                                                    ? 'bg-emerald-600 text-white shadow-xs'
                                                                    : 'bg-white text-slate-700 border border-emerald-200/90'
                                                            }`}
                                                        >
                                                            <span>{bItem.bus_name}</span>
                                                            <span className="opacity-75">·</span>
                                                            <span>{bItem.departure_time}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Upcoming Real-Time GAPEKA Train Schedule Strip */}
                                        {isTrain && vehicle.upcoming_schedule && vehicle.upcoming_schedule.length > 0 && (
                                            <div className="pt-1.5 border-t border-orange-200/70">
                                                <div className="text-[9.5px] font-bold uppercase tracking-wider text-orange-800/80 mb-1">
                                                    Jadwal Keberangkatan {leg.board_stop} (GAPEKA)
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {vehicle.upcoming_schedule.map((item, sIdx) => (
                                                        <span
                                                            key={item.train_number + sIdx}
                                                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 ${
                                                                sIdx === 0
                                                                    ? 'bg-orange-600 text-white shadow-xs'
                                                                    : 'bg-white text-slate-700 border border-orange-200/90'
                                                            }`}
                                                        >
                                                            <span>{item.train_number}</span>
                                                            <span className="opacity-75">·</span>
                                                            <span>{item.departure_time}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    );
                                })()}
                            </div>
                        </div>
                    );
                })}

                {/* 3. Destination Node */}
                <div className="relative">
                    <div className="absolute -left-[23px] top-0.5 w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-white ring-4 ring-white shadow-sm">
                        <MapPin className="w-3 h-3 text-white" />
                    </div>
                    <div>
                        <span className="text-[10px] font-bold tracking-wider text-rose-600 uppercase">
                            Dropoff (Point B)
                        </span>
                        <h4 className="text-xs font-bold text-slate-800 leading-snug">
                            {destination ? destination.name : 'Selected Dropoff Destination'}
                        </h4>
                    </div>
                </div>
            </div>
        </div>
    );
};
