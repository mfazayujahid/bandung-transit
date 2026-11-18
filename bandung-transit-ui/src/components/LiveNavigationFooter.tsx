import React from 'react';
import {
    Compass,
    X,
    List,
} from 'lucide-react';
import type { TripPlan } from '../types/transit';

interface LiveNavigationFooterProps {
    trip: TripPlan;
    currentLegIndex: number;
    remainingMinutes: number;
    remainingMeters: number;
    gpsSpeedKmh?: number | null;
    isSimulating?: boolean;
    onRecenter: () => void;
    onExitNavigation: () => void;
    onToggleStepList?: () => void;
    showStepList?: boolean;
}

export const LiveNavigationFooter: React.FC<LiveNavigationFooterProps> = ({
    trip,
    currentLegIndex,
    remainingMinutes,
    remainingMeters,
    gpsSpeedKmh = null,
    isSimulating = false,
    onRecenter,
    onExitNavigation,
    onToggleStepList,
    showStepList,
}) => {
    // Compute ETA time string (e.g., "13:45")
    const etaDate = new Date(Date.now() + remainingMinutes * 60 * 1000);
    const etaString = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const distString =
        remainingMeters >= 1000
            ? `${(remainingMeters / 1000).toFixed(1)} km`
            : `${Math.round(remainingMeters)} m`;

    return (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 pointer-events-auto md:static md:w-[420px] md:px-0">
            <div className="bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-2xl p-3 flex items-center justify-between">
                {/* Time & ETA summary */}
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex flex-col items-center justify-center min-w-[54px]">
                        <span className="text-lg font-black leading-none text-emerald-700">
                            {Math.max(1, Math.round(remainingMinutes))}
                        </span>
                        <span className="text-[10px] font-bold text-emerald-600 mt-0.5">mnt</span>
                    </div>

                    <div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 font-semibold">
                            <span className="whitespace-nowrap">
                                Tiba: <strong className="text-slate-800">{etaString}</strong>
                            </span>
                            <span>•</span>
                            <span className="whitespace-nowrap">{distString}</span>
                            {!isSimulating && gpsSpeedKmh !== null && gpsSpeedKmh >= 1 && (
                                <>
                                    <span>•</span>
                                    <span className="text-emerald-700 font-bold whitespace-nowrap">
                                        {Math.round(gpsSpeedKmh)} km/j
                                    </span>
                                </>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                            Langkah {Math.min(currentLegIndex + 1, trip.legs.length)} / {trip.legs.length}
                        </p>
                    </div>
                </div>

                {/* Right Quick Controls */}
                <div className="flex items-center gap-1.5">
                    {/* Recenter Map Button */}
                    <button
                        type="button"
                        onClick={onRecenter}
                        title="Pusatkan Kamera ke Posisi Saya"
                        className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors shadow-xs"
                    >
                        <Compass className="w-4 h-4 text-slate-700" />
                    </button>

                    {/* Step list toggle */}
                    {onToggleStepList && (
                        <button
                            type="button"
                            onClick={onToggleStepList}
                            title="Buka / Tutup Daftar Langkah"
                            className={`p-2.5 rounded-xl transition-colors shadow-xs ${
                                showStepList
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                        >
                            <List className="w-4 h-4" />
                        </button>
                    )}

                    {/* Red Exit Navigation Button */}
                    <button
                        type="button"
                        onClick={onExitNavigation}
                        title="Selesai & Keluar Navigasi"
                        className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs shadow-md shadow-rose-600/30 transition-all ml-1"
                    >
                        <X className="w-4 h-4" />
                        <span>Keluar</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
