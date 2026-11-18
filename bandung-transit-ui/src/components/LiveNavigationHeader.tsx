import React from 'react';
import {
    Footprints,
    Bus,
    Train,
    CheckCircle2,
    X,
    ChevronRight,
    Radio,
    Clock,
    LocateFixed,
    Loader2,
    AlertTriangle,
    RefreshCw,
    BellRing,
} from 'lucide-react';
import type { TripLeg, TripPlan } from '../types/transit';
import { CORRIDOR_BRAND_COLORS } from '../constants/bandungLandmarks';

export type GpsNavStatus = 'IDLE' | 'SEARCHING' | 'LOCKED' | 'ERROR' | 'SIMULATED';

interface LiveNavigationHeaderProps {
    trip: TripPlan;
    currentLegIndex: number;
    userLocation: [number, number] | null;
    isSimulating: boolean;
    gpsStatus: GpsNavStatus;
    gpsAccuracy: number | null;
    gpsErrorMsg: string | null;
    remainingLegMeters: number;
    offRoute: boolean;
    distanceOffRouteMeters: number;
    approachingCheckpoint: boolean;
    onToggleSimulate: () => void;
    onNextStep: () => void;
    onPrevStep: () => void;
    onExitNavigation: () => void;
    onRerouteFromCurrentLocation?: () => void;
}

export const LiveNavigationHeader: React.FC<LiveNavigationHeaderProps> = ({
    trip,
    currentLegIndex,
    isSimulating,
    gpsStatus,
    gpsAccuracy,
    gpsErrorMsg,
    remainingLegMeters,
    offRoute,
    distanceOffRouteMeters,
    approachingCheckpoint,
    onToggleSimulate,
    onNextStep,
    onPrevStep,
    onExitNavigation,
    onRerouteFromCurrentLocation,
}) => {
    const legs = trip.legs || [];
    const isArrived = currentLegIndex >= legs.length;
    const currentLeg: TripLeg | undefined = legs[currentLegIndex];
    const nextLeg: TripLeg | undefined = legs[currentLegIndex + 1];

    const isTrain = currentLeg?.type === 'TRAIN';
    const corridorKey = currentLeg?.corridor_code || (isTrain ? 'CLR' : 'K1D');
    const brand = CORRIDOR_BRAND_COLORS[corridorKey] || {
        color: currentLeg?.color || (isTrain ? '#1e3a8a' : '#2563eb'),
        badgeText: corridorKey,
    };

    const displayWalkMeters =
        remainingLegMeters > 0
            ? Math.round(remainingLegMeters)
            : Math.round(currentLeg?.distance_meters || 100);

    return (
        <div className="w-full max-w-lg mx-auto pointer-events-auto px-3 pt-3 md:pt-4">
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white rounded-2xl p-3.5 shadow-2xl border border-slate-700/80 backdrop-blur-xl">
                {/* Top Status & Controls Bar */}
                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-700/60 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {isSimulating || gpsStatus === 'SIMULATED' ? (
                            <span
                                data-testid="nav-gps-status"
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shrink-0"
                            >
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                <span>SIMULASI</span>
                            </span>
                        ) : gpsStatus === 'LOCKED' ? (
                            <span
                                data-testid="nav-gps-status"
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 shrink-0"
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                                <span>GPS AKTIF</span>
                                {gpsAccuracy !== null && (
                                    <span className="text-[10px] text-emerald-200/80 font-semibold">
                                        ±{Math.round(gpsAccuracy)}m
                                    </span>
                                )}
                            </span>
                        ) : gpsStatus === 'ERROR' ? (
                            <span
                                data-testid="nav-gps-status"
                                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40 shrink-0"
                            >
                                <AlertTriangle className="w-3 h-3 text-rose-400" />
                                <span>GPS TERKENDALA</span>
                            </span>
                        ) : (
                            <span
                                data-testid="nav-gps-status"
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-bold border border-sky-500/40 shrink-0"
                            >
                                <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                                <span>MENCARI GPS...</span>
                            </span>
                        )}

                        {!isArrived && (
                            <span className="text-slate-400 font-semibold shrink-0 whitespace-nowrap">
                                <span className="hidden sm:inline">Langkah </span>
                                {currentLegIndex + 1}/{legs.length}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        {/* Simulation Mode Toggle (Optional Demo Mode) */}
                        <button
                            type="button"
                            data-testid="toggle-simulate-btn"
                            onClick={onToggleSimulate}
                            title={
                                isSimulating
                                    ? 'Kembali ke GPS Real-Time'
                                    : 'Jalankan Simulasi Demo'
                            }
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                                isSimulating
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                    : 'bg-slate-700/60 hover:bg-slate-700 text-slate-300 border border-slate-600'
                            }`}
                        >
                            {isSimulating ? (
                                <>
                                    <LocateFixed className="w-3 h-3" />
                                    <span>Pakai GPS</span>
                                </>
                            ) : (
                                <span>▶️ Simulasi</span>
                            )}
                        </button>

                        {/* Manual Step Override */}
                        {currentLegIndex > 0 && (
                            <button
                                type="button"
                                onClick={onPrevStep}
                                className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] border border-slate-700 cursor-pointer"
                                title="Langkah Sebelumnya"
                            >
                                ◀
                            </button>
                        )}
                        {!isArrived && (
                            <button
                                type="button"
                                onClick={onNextStep}
                                className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] border border-slate-700 flex items-center gap-0.5 cursor-pointer"
                                title="Langkah Selanjutnya"
                            >
                                <span>Lanjut</span>
                                <ChevronRight className="w-3 h-3" />
                            </button>
                        )}

                        {/* Exit Navigation */}
                        <button
                            type="button"
                            onClick={onExitNavigation}
                            className="p-1 rounded-full bg-slate-800/80 hover:bg-rose-600 text-slate-300 hover:text-white transition-colors ml-0.5 cursor-pointer"
                            title="Keluar Navigasi"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Main Instruction Display */}
                {isArrived ? (
                    <div className="flex items-center gap-3 py-1">
                        <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/30">
                            <CheckCircle2 className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-base md:text-lg font-black text-white leading-tight">
                                Anda Telah Sampai di Tujuan!
                            </h3>
                            <p className="text-xs text-emerald-300 mt-0.5">
                                Perjalanan selesai. Terima kasih telah menggunakan Bandung Transit.
                            </p>
                        </div>
                    </div>
                ) : currentLeg ? (
                    <div className="flex items-start gap-3">
                        {/* Action Icon */}
                        <div className="mt-0.5 shrink-0">
                            {currentLeg.type === 'WALK' || currentLeg.type === 'TRANSFER_WALK' ? (
                                <div className="w-10 h-10 rounded-xl bg-blue-600/90 text-white flex items-center justify-center shadow-md shadow-blue-600/30">
                                    <Footprints className="w-5 h-5" />
                                </div>
                            ) : isTrain ? (
                                <div
                                    style={{ backgroundColor: '#1e3a8a' }}
                                    className="w-10 h-10 rounded-xl text-white flex flex-col items-center justify-center shadow-md"
                                >
                                    <Train className="w-4 h-4" />
                                    <span className="text-[9px] font-black">CLR</span>
                                </div>
                            ) : (
                                <div
                                    style={{ backgroundColor: brand.color }}
                                    className="w-10 h-10 rounded-xl text-white flex flex-col items-center justify-center shadow-md"
                                >
                                    <Bus className="w-4 h-4" />
                                    <span className="text-[9px] font-black">{brand.badgeText}</span>
                                </div>
                            )}
                        </div>

                        {/* Instruction Text */}
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm md:text-base font-black text-white leading-snug">
                                {currentLeg.type === 'WALK' && (
                                    <>
                                        Jalan {displayWalkMeters}m ke{' '}
                                        <span className="text-emerald-400">
                                            {currentLeg.instruction?.split('to ')[1] || 'titik transit'}
                                        </span>
                                    </>
                                )}
                                {currentLeg.type === 'TRANSFER_WALK' && (
                                    <>
                                        Transfer jalan kaki {displayWalkMeters}m ke{' '}
                                        <span className="text-amber-400">
                                            {currentLeg.instruction?.split('to ')[1] || 'stasiun / halte berikutnya'}
                                        </span>
                                    </>
                                )}
                                {currentLeg.type === 'BUS' && (
                                    <>
                                        Naik Bus <span className="text-blue-400">{brand.badgeText}</span> ({currentLeg.board_stop} ➔ {currentLeg.alight_stop})
                                    </>
                                )}
                                {currentLeg.type === 'TRAIN' && (
                                    <>
                                        Naik Kereta <span className="text-blue-300">Commuter Line</span> ({currentLeg.board_stop} ➔ {currentLeg.alight_stop})
                                    </>
                                )}
                            </h3>

                            {/* Secondary / Upcoming hint */}
                            {currentLeg.type === 'BUS' || currentLeg.type === 'TRAIN' ? (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                                    <span className="flex items-center gap-1 font-semibold text-slate-200">
                                        <Clock className="w-3 h-3 text-blue-400" />
                                        <span>
                                            {currentLeg.stop_count || 1} {isTrain ? 'stasiun' : 'halte'} ({Math.round(currentLeg.duration_seconds / 60)} mnt)
                                        </span>
                                    </span>
                                    {currentLeg.incoming_bus && (
                                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 text-[11px] font-bold">
                                            <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
                                            <span>
                                                {isTrain
                                                    ? `${currentLeg.incoming_bus.train_number || 'KA'}: tiba ~${Math.round(currentLeg.incoming_bus.eta_seconds / 60)} mnt`
                                                    : `${currentLeg.incoming_bus.bus_name || 'Bus'}: tiba ~${Math.round(currentLeg.incoming_bus.eta_seconds / 60)} mnt`}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            ) : nextLeg ? (
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                    Berikutnya: Naik {nextLeg.type === 'TRAIN' ? 'Commuter Line' : (nextLeg.corridor_code || 'Bus')} di {nextLeg.board_stop || 'Halte'}
                                </p>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {/* Approaching Alighting Stop Alert (Bus / Train) */}
                {!isArrived && approachingCheckpoint && currentLeg && (
                    <div
                        data-testid="approaching-stop-alert"
                        className="mt-2.5 px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-100 flex items-center gap-2 text-xs font-bold"
                    >
                        <BellRing className="w-4 h-4 text-emerald-300 animate-bounce shrink-0" />
                        <span>
                            Bersiap turun di <span className="text-white">{currentLeg.alight_stop}</span> (~{Math.round(remainingLegMeters)}m lagi)
                        </span>
                    </div>
                )}

                {/* Off-Route Warning with One-Tap Reroute (Real GPS Mode) */}
                {!isArrived && !isSimulating && gpsStatus === 'LOCKED' && offRoute && (
                    <div
                        data-testid="off-route-alert"
                        className="mt-2.5 px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-100 flex items-center justify-between gap-2 text-[11px]"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                            <span className="font-semibold leading-snug">
                                Anda melenceng ~{distanceOffRouteMeters}m dari jalur rencana.
                            </span>
                        </div>
                        {onRerouteFromCurrentLocation && (
                            <button
                                type="button"
                                onClick={onRerouteFromCurrentLocation}
                                className="px-2.5 py-1 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-[10px] flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                                <RefreshCw className="w-3 h-3" />
                                <span>Rute Ulang</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Real GPS Error Notice (e.g., Denied or HTTP LAN Blocked) + Optional Simulation Fallback */}
                {!isSimulating && gpsStatus === 'ERROR' && gpsErrorMsg && (
                    <div
                        data-testid="nav-gps-error"
                        className="mt-2.5 px-3 py-2 rounded-xl bg-rose-500/20 border border-rose-400/50 text-rose-100 flex items-start justify-between gap-2 text-[11px] leading-snug"
                    >
                        <div className="flex items-start gap-2 min-w-0">
                            <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                            <span>{gpsErrorMsg}</span>
                        </div>
                        <button
                            type="button"
                            onClick={onToggleSimulate}
                            className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-white font-bold text-[10px] shrink-0 cursor-pointer"
                        >
                            ▶️ Simulasi
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
