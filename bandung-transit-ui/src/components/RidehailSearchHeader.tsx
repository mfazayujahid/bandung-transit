import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    ArrowUpDown,
    MapPin,
    Navigation,
    X,
    Sparkles,
    ChevronDown,
    ChevronUp,
    Bus,
    Train,
    LocateFixed,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import { BANDUNG_LANDMARKS } from '../constants/bandungLandmarks';
import type { InputMode, LocationPoint } from '../types/transit';
import { API_BASE } from '../utils/apiConfig';

interface SearchItem {
    name: string;
    description: string;
    coords: [number, number];
    type: 'landmark' | 'shelter';
    corridorCode?: string;
    corridorColor?: string;
}

interface RidehailSearchHeaderProps {
    origin: LocationPoint | null;
    destination: LocationPoint | null;
    activeMode: InputMode;
    onSelectMode: (mode: InputMode) => void;
    onSwap: () => void;
    onClearOrigin: () => void;
    onClearDestination: () => void;
    onSelectPreset: (preset: LocationPoint) => void;
    onUseCurrentLocation: () => void;
    locatingOrigin?: boolean;
    locationError?: string | null;
    onClearLocationError?: () => void;
    loading?: boolean;
    routeError?: string | null;
}

export const RidehailSearchHeader: React.FC<RidehailSearchHeaderProps> = ({
    origin,
    destination,
    activeMode,
    onSelectMode,
    onSwap,
    onClearOrigin,
    onClearDestination,
    onSelectPreset,
    onUseCurrentLocation,
    locatingOrigin = false,
    locationError = null,
    onClearLocationError,
    loading = false,
    routeError = null,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showPresets, setShowPresets] = useState(false);
    const [shelters, setShelters] = useState<SearchItem[]>([]);
    const [originText, setOriginText] = useState(origin?.name || '');
    const [destText, setDestText] = useState(destination?.name || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const originInputRef = useRef<HTMLInputElement>(null);
    const destInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Sync input text when origin/destination props change (e.g. from map click)
    useEffect(() => {
        setOriginText(origin?.name || '');
    }, [origin]);

    useEffect(() => {
        setDestText(destination?.name || '');
    }, [destination]);

    // Fetch all Bandung transit shelters for instant autocomplete
    useEffect(() => {
        let isMounted = true;
        fetch(`${API_BASE}/api/transit/stops`)
            .then(async (res) => {
                if (!res.ok) return;
                const data = await res.json();
                if (!isMounted) return;
                const items: SearchItem[] = (data.features || []).map((f: any) => ({
                    name: `Halte ${f.properties.name}`,
                    description: `Koridor ${f.properties.corridor_code} (${f.properties.corridor_name})`,
                    coords: f.geometry.coordinates as [number, number],
                    type: 'shelter',
                    corridorCode: f.properties.corridor_code,
                    corridorColor: f.properties.color || '#2563eb',
                }));
                setShelters(items);
            })
            .catch(() => {});
        return () => {
            isMounted = false;
        };
    }, []);

    // Combine Landmarks and Shelters into unified search collection
    const allSearchableItems: SearchItem[] = useMemo(() => {
        const landmarkItems: SearchItem[] = BANDUNG_LANDMARKS.map((lm) => ({
            name: lm.name,
            description: lm.description || 'Bandung Landmark / Hub',
            coords: lm.coords,
            type: 'landmark',
        }));
        return [...landmarkItems, ...shelters];
    }, [shelters]);

    // Filter suggestions based on active field input query
    const activeQuery = activeMode === 'ORIGIN' ? originText : destText;
    const filteredSuggestions = useMemo(() => {
        const q = activeQuery.trim().toLowerCase();
        if (!q) {
            // If empty, show popular landmarks
            return allSearchableItems.filter((i) => i.type === 'landmark').slice(0, 6);
        }
        return allSearchableItems
            .filter(
                (item) =>
                    item.name.toLowerCase().includes(q) ||
                    item.description.toLowerCase().includes(q) ||
                    (item.corridorCode && item.corridorCode.toLowerCase().includes(q))
            )
            .slice(0, 8);
    }, [allSearchableItems, activeQuery]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, []);

    // Select suggestion item
    const handleSelectSuggestion = (item: SearchItem) => {
        const locPoint: LocationPoint = {
            name: item.name,
            description: item.description,
            coords: item.coords,
            isPreset: true,
        };

        if (activeMode === 'ORIGIN') {
            setOriginText(item.name);
            onSelectPreset(locPoint);
            setIsDropdownOpen(false);
            if (!destination) {
                onSelectMode('DEST');
                setTimeout(() => destInputRef.current?.focus(), 150);
            }
        } else {
            setDestText(item.name);
            onSelectPreset(locPoint);
            setIsDropdownOpen(false);
            if (!origin) {
                onSelectMode('ORIGIN');
                setTimeout(() => originInputRef.current?.focus(), 150);
            }
        }
    };

    // Collapsed Pill View (maximizes map visibility)
    if (isCollapsed) {
        return (
            <div className="w-full relative pointer-events-auto select-none">
                <div
                    onClick={() => setIsCollapsed(false)}
                    className={`relative overflow-hidden bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border px-3.5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 active:scale-[0.99] transition-all ${
                        routeError && !loading
                            ? 'border-rose-300'
                            : loading
                            ? 'border-blue-300'
                            : 'border-slate-200/90'
                    }`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex items-center gap-1 shrink-0">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs" />
                            <span className="w-1.5 h-0.5 bg-slate-300" />
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-xs" />
                        </div>
                        <div className="text-xs font-bold text-slate-800 truncate">
                            {origin && destination
                                ? `${origin.name} → ${destination.name}`
                                : origin
                                ? `${origin.name} → Tentukan Tujuan`
                                : 'Cari Rute Transit Bandung...'}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {loading ? (
                            <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                Mencari
                            </span>
                        ) : routeError ? (
                            <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full border border-rose-200">
                                Tidak Ada Rute
                            </span>
                        ) : (
                            <span className="text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-0.5 rounded-full border border-blue-200">
                                Ubah Rute
                            </span>
                        )}
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                    </div>

                    {loading && (
                        <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-100 overflow-hidden">
                            <div className="h-full w-1/2 bg-blue-600 animate-route-loading" />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Expanded Full Search Card View with Typeable Inputs & Autocomplete
    return (
        <div ref={containerRef} className="w-full relative pointer-events-auto transition-all select-none">
            <div className="relative overflow-hidden bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200/80 p-3.5 transition-all">
                {/* Search Header Banner */}
                <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-black tracking-wider shadow-xs">
                            BT
                        </div>
                        <span className="font-bold text-sm tracking-tight text-slate-800">
                            Bandung Transit
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {loading ? (
                            <span
                                data-testid="header-route-loading"
                                className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-600 text-white shadow-xs flex items-center gap-1"
                            >
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Mencari Rute...
                            </span>
                        ) : routeError ? (
                            <span
                                data-testid="header-route-error"
                                className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1"
                            >
                                <AlertCircle className="w-3 h-3 text-rose-600" />
                                Rute Tidak Ditemukan
                            </span>
                        ) : (
                            <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full transition-colors flex items-center gap-1 ${
                                    activeMode === 'ORIGIN'
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                        : 'bg-rose-100 text-rose-800 border border-rose-300'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full animate-ping-slow bg-current" />
                                {activeMode === 'ORIGIN' ? 'Ketik / Pilih Pickup' : 'Ketik / Pilih Dropoff'}
                            </span>
                        )}

                        {/* Collapse Button */}
                        <button
                            type="button"
                            onClick={() => setIsCollapsed(true)}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors ml-0.5"
                            title="Sembunyikan panel untuk melihat peta"
                            aria-label="Collapse search panel"
                        >
                            <ChevronUp className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Input Fields Container */}
                <div className="relative flex flex-col gap-2 bg-slate-50/80 border border-slate-200 rounded-xl p-2.5">
                    {/* Visual Connector Line between Origin & Destination */}
                    <div className="absolute left-[23px] top-[26px] bottom-[26px] w-[2px] border-l-2 border-dashed border-slate-300 pointer-events-none" />

                    {/* Origin Row (Point A) - Real Editable Input + Current Location GPS */}
                    <div
                        onClick={() => {
                            onSelectMode('ORIGIN');
                            setIsDropdownOpen(true);
                            originInputRef.current?.focus();
                        }}
                        className={`flex items-center gap-2.5 p-2 pr-10 rounded-lg transition-all ${
                            activeMode === 'ORIGIN'
                                ? 'bg-white shadow-sm ring-2 ring-emerald-500/20'
                                : 'hover:bg-white/60'
                        }`}
                    >
                        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 shadow-sm shadow-emerald-500/30">
                            <div className="w-2 h-2 rounded-full bg-white" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                                Pickup Point (A)
                            </p>
                            <input
                                ref={originInputRef}
                                type="text"
                                value={originText}
                                placeholder={
                                    locatingOrigin
                                        ? 'Mendeteksi lokasi GPS Anda...'
                                        : 'Ketik lokasi jemput atau gunakan GPS...'
                                }
                                onChange={(e) => {
                                    setOriginText(e.target.value);
                                    onSelectMode('ORIGIN');
                                    setIsDropdownOpen(true);
                                }}
                                onFocus={() => {
                                    onSelectMode('ORIGIN');
                                    setIsDropdownOpen(true);
                                }}
                                className="w-full text-xs font-semibold text-slate-800 placeholder-slate-400 bg-transparent outline-none truncate"
                            />
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                type="button"
                                data-testid="use-current-location-btn"
                                disabled={locatingOrigin}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectMode('ORIGIN');
                                    setIsDropdownOpen(false);
                                    onUseCurrentLocation();
                                }}
                                title="Gunakan lokasi saya saat ini (GPS)"
                                aria-label="Gunakan lokasi saya saat ini"
                                className={`p-1.5 rounded-full transition-all cursor-pointer ${
                                    locatingOrigin
                                        ? 'bg-emerald-50 text-emerald-600'
                                        : 'text-emerald-600 hover:bg-emerald-50 active:scale-95'
                                }`}
                            >
                                {locatingOrigin ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <LocateFixed className="w-4 h-4" />
                                )}
                            </button>

                            {originText && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOriginText('');
                                        onClearOrigin();
                                        originInputRef.current?.focus();
                                    }}
                                    className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
                                    aria-label="Clear pickup"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Destination Row (Point B) - Real Editable Input */}
                    <div
                        onClick={() => {
                            onSelectMode('DEST');
                            setIsDropdownOpen(true);
                            destInputRef.current?.focus();
                        }}
                        className={`flex items-center gap-2.5 p-2 pr-10 rounded-lg transition-all ${
                            activeMode === 'DEST'
                                ? 'bg-white shadow-sm ring-2 ring-rose-500/20'
                                : 'hover:bg-white/60'
                        }`}
                    >
                        <div className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center shrink-0 shadow-sm shadow-rose-500/30">
                            <MapPin className="w-3 h-3 text-white" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">
                                Dropoff Point (B)
                            </p>
                            <input
                                ref={destInputRef}
                                type="text"
                                value={destText}
                                placeholder="Ketik lokasi tujuan (cth: Simpang Dago)..."
                                onChange={(e) => {
                                    setDestText(e.target.value);
                                    onSelectMode('DEST');
                                    setIsDropdownOpen(true);
                                }}
                                onFocus={() => {
                                    onSelectMode('DEST');
                                    setIsDropdownOpen(true);
                                }}
                                className="w-full text-xs font-semibold text-slate-800 placeholder-slate-400 bg-transparent outline-none truncate"
                            />
                        </div>

                        {destText && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDestText('');
                                    onClearDestination();
                                    destInputRef.current?.focus();
                                }}
                                className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
                                aria-label="Clear dropoff"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Swap Button */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSwap();
                        }}
                        title="Tukar Titik Jemput & Tujuan"
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 border border-slate-200 rounded-full shadow-sm transition-all cursor-pointer"
                    >
                        <ArrowUpDown className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Geolocation Feedback Alert */}
                {locationError && (
                    <div className="mt-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2 text-[11px] leading-snug">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span className="flex-1 font-medium">{locationError}</span>
                        {onClearLocationError && (
                            <button
                                type="button"
                                onClick={onClearLocationError}
                                className="p-0.5 text-amber-600 hover:text-amber-800 rounded cursor-pointer shrink-0"
                                aria-label="Tutup pesan lokasi"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}

                {/* Autocomplete Suggestions Dropdown Menu */}
                {isDropdownOpen && (
                    <div className="mt-2 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                        {activeMode === 'ORIGIN' && (
                            <button
                                type="button"
                                data-testid="dropdown-use-current-location"
                                disabled={locatingOrigin}
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    onUseCurrentLocation();
                                }}
                                className="w-full px-3 py-2.5 bg-emerald-50/70 hover:bg-emerald-100/80 active:bg-emerald-100 border-b border-emerald-100 cursor-pointer transition-colors flex items-center gap-2.5 text-left"
                            >
                                <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                                    {locatingOrigin ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <LocateFixed className="w-3.5 h-3.5" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="text-xs font-bold text-emerald-900">
                                        {locatingOrigin
                                            ? 'Mendeteksi Lokasi Anda...'
                                            : 'Gunakan Lokasi Saya Saat Ini'}
                                    </h4>
                                    <p className="text-[10px] text-emerald-700 truncate">
                                        Otomatis set titik jemput dari GPS perangkat
                                    </p>
                                </div>
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600/10 text-emerald-800 text-[9px] font-bold shrink-0">
                                    GPS
                                </span>
                            </button>
                        )}

                        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <span>
                                {activeMode === 'ORIGIN' ? 'Rekomendasi Penjemputan' : 'Rekomendasi Tujuan'}
                            </span>
                            <span>{filteredSuggestions.length} lokasi</span>
                        </div>

                        {filteredSuggestions.length > 0 ? (
                            <div className="divide-y divide-slate-100">
                                {filteredSuggestions.map((item, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => handleSelectSuggestion(item)}
                                        className="px-3 py-2 hover:bg-blue-50/70 active:bg-blue-100 cursor-pointer transition-colors flex items-center justify-between gap-2 text-left"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            {(() => {
                                                const isStation = item.name.toLowerCase().includes('stasiun') || item.corridorCode === 'CLR';
                                                return (
                                                    <div
                                                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                                            isStation
                                                                ? 'bg-blue-900 text-white'
                                                                : item.type === 'shelter'
                                                                ? 'bg-blue-100 text-blue-700'
                                                                : 'bg-emerald-100 text-emerald-700'
                                                        }`}
                                                    >
                                                        {isStation ? (
                                                            <Train className="w-3.5 h-3.5" />
                                                        ) : item.type === 'shelter' ? (
                                                            <Bus className="w-3.5 h-3.5" />
                                                        ) : (
                                                            <MapPin className="w-3.5 h-3.5" />
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                            <div className="min-w-0 flex-1">
                                                <h4 className="text-xs font-bold text-slate-800 truncate">
                                                    {item.name}
                                                </h4>
                                                <p className="text-[10px] text-slate-500 truncate">
                                                    {item.description}
                                                </p>
                                            </div>
                                        </div>

                                        {item.corridorCode && (
                                            <span
                                                style={{ backgroundColor: item.corridorColor || '#2563eb' }}
                                                className="px-2 py-0.5 rounded text-white text-[9px] font-black shrink-0 shadow-xs"
                                            >
                                                {item.corridorCode}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-3 text-center text-xs text-slate-400">
                                Tidak ada halte atau landmark yang cocok dengan "{activeQuery}"
                            </div>
                        )}
                    </div>
                )}

                {/* Quick Landmark Presets (Horizontal Scrollable Chips like Uber/Grab) */}
                <div className="mt-2.5">
                    <div className="flex items-center justify-between mb-1.5 px-0.5">
                        <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-500" />
                            Popular Bandung Hubs
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowPresets(!showPresets)}
                            className="text-[11px] text-blue-600 font-medium hover:underline cursor-pointer"
                        >
                            {showPresets ? 'Collapse' : 'Show All'}
                        </button>
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
                        {BANDUNG_LANDMARKS.slice(0, showPresets ? BANDUNG_LANDMARKS.length : 5).map((landmark) => (
                            <button
                                key={landmark.name}
                                type="button"
                                onClick={() => {
                                    if (activeMode === 'ORIGIN') setOriginText(landmark.name);
                                    else setDestText(landmark.name);
                                    onSelectPreset(landmark);
                                }}
                                className="whitespace-nowrap px-2.5 py-1 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-medium rounded-full border border-slate-200/80 transition-all flex items-center gap-1 cursor-pointer shrink-0"
                            >
                                <Navigation className="w-2.5 h-2.5 text-slate-400" />
                                {landmark.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Bottom edge route-loading progress bar right on the search card */}
                {loading && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-blue-100 overflow-hidden">
                        <div className="h-full w-1/2 bg-gradient-to-r from-blue-500 via-indigo-600 to-blue-500 animate-route-loading" />
                    </div>
                )}
            </div>
        </div>
    );
};
