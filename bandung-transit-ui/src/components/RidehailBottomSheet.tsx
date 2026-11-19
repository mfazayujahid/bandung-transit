import React, { useRef } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Navigation,
    Route,
    RotateCcw,
    AlertCircle,
    Loader2,
    Clock,
    Train,
    Banknote,
} from 'lucide-react';
import { TripTimeline } from './TripTimeline';
import { CORRIDOR_BRAND_COLORS } from '../constants/bandungLandmarks';
import { type LocationPoint, type SnapState, type TripPlan, getTripFareInfo } from '../types/transit';

interface RidehailBottomSheetProps {
    trip: TripPlan | null;
    origin: LocationPoint | null;
    destination: LocationPoint | null;
    loading: boolean;
    errorMsg: string | null;
    onResetTrip: () => void;
    snapState: SnapState;
    onChangeSnapState: (state: SnapState) => void;
    onStartNavigation?: () => void;
}

export const RidehailBottomSheet: React.FC<RidehailBottomSheetProps> = ({
    trip,
    origin,
    destination,
    loading,
    errorMsg,
    onResetTrip,
    snapState,
    onChangeSnapState,
    onStartNavigation,
}) => {
    const touchStartY = useRef<number | null>(null);
    const touchDeltaY = useRef<number>(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
        touchDeltaY.current = 0;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStartY.current === null) return;
        touchDeltaY.current = e.touches[0].clientY - touchStartY.current;
    };

    const handleTouchEnd = () => {
        if (touchStartY.current === null) return;
        const delta = touchDeltaY.current;

        // Threshold for swipe up / swipe down
        if (delta < -45) {
            // Swiped UP
            if (snapState === 'COLLAPSED') onChangeSnapState('HALF');
            else if (snapState === 'HALF') onChangeSnapState('FULL');
        } else if (delta > 45) {
            // Swiped DOWN
            if (snapState === 'FULL') onChangeSnapState('HALF');
            else if (snapState === 'HALF') onChangeSnapState('COLLAPSED');
        }

        touchStartY.current = null;
        touchDeltaY.current = 0;
    };

    // Calculate mobile height based on snapState and active feedback state
    const getMobileHeightStyle = () => {
        switch (snapState) {
            case 'COLLAPSED':
                if (loading) return 'h-[104px]';
                if (errorMsg) return 'h-[144px]';
                if (trip) return 'h-[92px]';
                return 'h-[82px]';
            case 'HALF':
                return 'h-[50dvh]';
            case 'FULL':
                return 'h-[85dvh]';
        }
    };

    // Find first incoming vehicle (train or bus) for collapsed glance
    const incomingVehicle = trip?.legs?.find((l) => l.incoming_bus)?.incoming_bus;
    const transitLegs = trip?.legs?.filter((l) => l.type === 'BUS' || l.type === 'TRAIN') || [];
    const fareInfo = getTripFareInfo(trip);

    return (
        <div
            className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${getMobileHeightStyle()}
                md:static md:w-full md:flex-1 md:min-h-0 md:max-h-[calc(100dvh-260px)] md:mt-0
                pointer-events-auto flex flex-col`}
        >
            <div
                className={`relative w-full h-full md:flex-1 md:min-h-0 bg-white/95 backdrop-blur-xl rounded-t-3xl md:rounded-2xl shadow-2xl border-t md:border flex flex-col overflow-hidden transition-colors ${
                    errorMsg && !loading
                        ? 'border-rose-300'
                        : loading
                        ? 'border-blue-300'
                        : 'border-slate-200/90'
                }`}
            >
                {/* Top Indeterminate Loading Progress Bar (Highly Visible on Mobile & Desktop) */}
                {loading && (
                    <div className="absolute top-0 inset-x-0 h-1 bg-blue-100 overflow-hidden z-20">
                        <div className="h-full w-1/2 bg-gradient-to-r from-blue-500 via-indigo-600 to-blue-500 rounded-full animate-route-loading" />
                    </div>
                )}

                {/* Drag Handle (Mobile only) */}
                <div
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onClick={() => {
                        if (snapState === 'COLLAPSED') onChangeSnapState('HALF');
                    }}
                    className="w-full pt-2 pb-1 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing md:hidden shrink-0"
                >
                    <div
                        className={`w-10 h-1 rounded-full ${
                            errorMsg && !loading ? 'bg-rose-300' : 'bg-slate-300'
                        }`}
                    />
                </div>

                {/* Mobile Collapsed: Loading State (Immediately visible without opening sheet) */}
                {snapState === 'COLLAPSED' && loading && (
                    <div
                        data-testid="mobile-collapsed-loading"
                        className="px-4 pb-3 pt-1 flex items-center gap-3 md:hidden"
                    >
                        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-extrabold text-slate-900 leading-tight">
                                Mencari rute terbaik...
                            </p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                Menghitung Bus BRT, Commuter Line & jalan kaki
                            </p>
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wide shrink-0 animate-pulse">
                            Loading
                        </span>
                    </div>
                )}

                {/* Mobile Collapsed: No Route Found / Error State (Immediately visible without opening sheet) */}
                {snapState === 'COLLAPSED' && !loading && errorMsg && (
                    <div
                        data-testid="mobile-collapsed-error"
                        onClick={() => onChangeSnapState('HALF')}
                        className="px-4 pb-3 pt-1 flex flex-col gap-2 cursor-pointer md:hidden"
                    >
                        <div className="flex items-start gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
                                <AlertCircle className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-extrabold text-rose-900 leading-tight">
                                        Rute Tidak Ditemukan
                                    </p>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onResetTrip();
                                        }}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-[11px] rounded-full shadow-xs shrink-0 cursor-pointer"
                                    >
                                        <RotateCcw className="w-3 h-3" />
                                        <span>Reset</span>
                                    </button>
                                </div>
                                <p className="text-[11px] font-medium text-rose-700 line-clamp-2 mt-0.5 leading-snug">
                                    {errorMsg}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1">
                                    Coba geser pin lebih dekat ke jalan utama, halte, atau stasiun.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Mobile Collapsed: Idle Guidance Bar (Never shows an empty white box) */}
                {snapState === 'COLLAPSED' && !loading && !errorMsg && !trip && (
                    <div
                        onClick={() => onChangeSnapState('HALF')}
                        className="px-4 pb-2.5 pt-1 flex items-center justify-between gap-3 cursor-pointer md:hidden"
                    >
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                    !origin
                                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                        : 'bg-rose-50 text-rose-600 border border-rose-200'
                                }`}
                            >
                                <Navigation className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 truncate">
                                    {!origin ? 'Tentukan Titik Jemput (A)' : 'Tentukan Titik Tujuan (B)'}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                    {!origin
                                        ? 'Ketuk peta, cari lokasi, atau tekan ikon GPS'
                                        : 'Ketuk peta atau cari halte / stasiun tujuan'}
                                </p>
                            </div>
                        </div>
                        <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>
                )}

                {/* Collapsed Compact Glance Row (Mobile only when collapsed & trip ready) */}
                {snapState === 'COLLAPSED' && !loading && !errorMsg && trip && (
                    <div
                        onClick={() => onChangeSnapState('HALF')}
                        className="px-4 pb-2.5 pt-1 flex items-center justify-between cursor-pointer md:hidden"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="flex items-center gap-1.5 shrink-0">
                                <Clock className="w-4 h-4 text-blue-600" />
                                <span className="text-base font-black text-slate-900 tracking-tight">
                                    {trip.total_duration_minutes} min
                                </span>
                            </div>

                            {/* Estimated Total Fare Badge */}
                            <div
                                data-testid="mobile-glance-fare"
                                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 shrink-0 shadow-2xs"
                            >
                                <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-xs font-black tracking-tight">{fareInfo.formatted}</span>
                            </div>

                            <div className="flex items-center gap-1 overflow-hidden">
                                {transitLegs.map((leg, idx) => {
                                    const isTrain = leg.type === 'TRAIN';
                                    const code = leg.corridor_code || (isTrain ? 'CLR' : 'K4');
                                    const brand = CORRIDOR_BRAND_COLORS[code] || {
                                        color: leg.color || (isTrain ? '#1e3a8a' : '#2563eb'),
                                        badgeText: code,
                                    };
                                    return (
                                        <span
                                            key={idx}
                                            style={{ backgroundColor: brand.color }}
                                            className="px-2 py-0.5 rounded text-white text-[10px] font-bold shrink-0 flex items-center gap-1"
                                        >
                                            {isTrain && <Train className="w-2.5 h-2.5" />}
                                            {brand.badgeText}
                                        </span>
                                    );
                                })}
                            </div>

                            {incomingVehicle && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border truncate hidden sm:inline-block ${
                                    incomingVehicle.is_train
                                        ? 'bg-blue-50 text-blue-900 border-blue-200'
                                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                }`}>
                                    {incomingVehicle.is_train
                                        ? `🚆 ${incomingVehicle.train_number || incomingVehicle.bus_name}`
                                        : `🟢 ${incomingVehicle.bus_name}`}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {onStartNavigation && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onStartNavigation();
                                    }}
                                    className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs rounded-full shadow-md shadow-emerald-600/30 transition-all shrink-0 cursor-pointer"
                                >
                                    <Navigation className="w-3 h-3 fill-current" />
                                    <span>Mulai</span>
                                </button>
                            )}
                            <div
                                onClick={() => onChangeSnapState('HALF')}
                                className="flex items-center gap-0.5 text-[11px] font-bold text-blue-600 p-1 cursor-pointer"
                            >
                                <span>Detail</span>
                                <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Standard Sheet Header (Shown when not collapsed, or on desktop) */}
                <div
                    className={`px-4 py-2 border-b border-slate-100 flex items-center justify-between shrink-0 ${
                        snapState === 'COLLAPSED' ? 'hidden md:flex' : 'flex'
                    }`}
                >
                    <div className="flex items-center gap-2">
                        <Route className="w-4 h-4 text-blue-600" />
                        <h3 className="font-bold text-sm text-slate-800 tracking-tight">
                            {trip ? 'Recommended Transit Route' : 'Journey Planner'}
                        </h3>
                    </div>

                    <div className="flex items-center gap-1">
                        {(origin || destination || trip) && (
                            <button
                                type="button"
                                onClick={onResetTrip}
                                title="Reset Plan"
                                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* Mobile Expand / Collapse toggle */}
                        <button
                            type="button"
                            onClick={() => {
                                if (snapState === 'COLLAPSED') onChangeSnapState('HALF');
                                else if (snapState === 'HALF') onChangeSnapState('FULL');
                                else onChangeSnapState('COLLAPSED');
                            }}
                            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors md:hidden cursor-pointer"
                            aria-label="Toggle drawer snap"
                        >
                            {snapState === 'FULL' ? (
                                <ChevronDown className="w-4 h-4" />
                            ) : (
                                <ChevronUp className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Prominent Start Navigation Banner (Desktop / Half / Full Sheet) */}
                {trip && onStartNavigation && snapState !== 'COLLAPSED' && (
                    <div className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between shrink-0 shadow-inner">
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded-full bg-white/20">
                                <Navigation className="w-3.5 h-3.5 fill-current text-white" />
                            </div>
                            <div>
                                <span className="text-xs font-black block leading-none">Mulai Panduan Perjalanan</span>
                                <span className="text-[10px] text-emerald-100 font-medium">Navigasi turn-by-turn & live tracking</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onStartNavigation}
                            className="px-3.5 py-1.5 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 font-black text-xs rounded-full shadow-md transition-all flex items-center gap-1 cursor-pointer"
                        >
                            <Navigation className="w-3 h-3 fill-current text-emerald-700" />
                            <span>Mulai</span>
                        </button>
                    </div>
                )}

                {/* Sheet Scrollable Content (Hidden on mobile when collapsed to save space) */}
                <div
                    className={`flex-1 min-h-0 overflow-y-auto px-4 py-3 overscroll-contain touch-pan-y ${
                        snapState === 'COLLAPSED' ? 'hidden md:block' : 'block'
                    }`}
                >
                    {loading && (
                        <div className="py-8 flex flex-col items-center justify-center text-center gap-2 text-blue-600">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                            <p className="text-xs font-semibold text-slate-700">
                                Menghitung rute transit multi-modal...
                            </p>
                            <p className="text-[11px] text-slate-400">
                                Menggabungkan Bus BRT, Commuter Line, & jalan kaki
                            </p>
                        </div>
                    )}

                    {errorMsg && !loading && (
                        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-800">
                            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-extrabold text-rose-900">Rute Tidak Ditemukan</p>
                                <p className="text-[11px] text-rose-700 mt-0.5 leading-snug">{errorMsg}</p>
                                <p className="text-[10px] text-rose-600/80 mt-1.5">
                                    Coba geser titik jemput atau tujuan lebih dekat ke halte BRT atau stasiun Commuter Line.
                                </p>
                                <button
                                    type="button"
                                    onClick={onResetTrip}
                                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-[11px] rounded-full shadow-xs transition-all cursor-pointer"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Reset & Pilih Ulang</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {!loading && !errorMsg && trip && (
                        <TripTimeline
                            origin={origin}
                            destination={destination}
                            legs={trip.legs}
                            totalMinutes={trip.total_duration_minutes}
                            trip={trip}
                        />
                    )}

                    {!loading && !errorMsg && !trip && (
                        <div className="py-6 flex flex-col items-center justify-center text-center px-2">
                            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3 shadow-inner">
                                <Navigation className="w-6 h-6" />
                            </div>
                            <h4 className="text-sm font-bold text-slate-800">Rencanakan Perjalanan Bandung</h4>
                            <p className="text-xs text-slate-500 max-w-[260px] mt-1 leading-relaxed">
                                {!origin
                                    ? 'Ketik lokasi atau ketuk halte/stasiun pada peta untuk menentukan titik jemput.'
                                    : 'Sekarang tentukan titik tujuan Anda untuk menemukan rute tercepat.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
