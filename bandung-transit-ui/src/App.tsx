import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TransitMap } from './components/TransitMap';
import { RidehailSearchHeader } from './components/RidehailSearchHeader';
import { RidehailBottomSheet } from './components/RidehailBottomSheet';
import { LiveNavigationHeader, type GpsNavStatus } from './components/LiveNavigationHeader';
import { LiveNavigationFooter } from './components/LiveNavigationFooter';
import type { InputMode, LocationPoint, SnapState, TripPlan } from './types/transit';
import { API_BASE } from './utils/apiConfig';
import {
    calculateBearing,
    getLegCoordinates,
    haversineMeters,
    evaluateNavigationProgress,
} from './utils/navigationEngine';

async function reverseGeocodePickup(coords: [number, number]): Promise<{ name: string; description: string }> {
    const [lng, lat] = coords;
    const fallbackName = `Lokasi Saya (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
                lat
            )}&lon=${encodeURIComponent(lng)}&zoom=18&accept-language=id`,
            { signal: controller.signal }
        );
        if (!res.ok) {
            return { name: fallbackName, description: 'Lokasi GPS saat ini' };
        }
        const data = await res.json();
        const addr = data?.address || {};
        const primary =
            addr.road ||
            addr.residential ||
            addr.amenity ||
            addr.building ||
            addr.neighbourhood ||
            addr.suburb ||
            addr.village ||
            data?.name;
        const area =
            addr.suburb ||
            addr.village ||
            addr.city_district ||
            addr.town ||
            addr.city ||
            addr.county;

        if (primary && area && primary !== area) {
            return {
                name: `Lokasi Saya · ${primary}`,
                description: `${area} (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            };
        }
        if (primary) {
            return {
                name: `Lokasi Saya · ${primary}`,
                description: `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            };
        }
        if (typeof data?.display_name === 'string' && data.display_name.trim()) {
            const shortLabel = data.display_name.split(',').slice(0, 2).join(',').trim();
            return {
                name: `Lokasi Saya · ${shortLabel}`,
                description: `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            };
        }
        return { name: fallbackName, description: 'Lokasi GPS saat ini' };
    } catch {
        return { name: fallbackName, description: 'Lokasi GPS saat ini' };
    } finally {
        window.clearTimeout(timer);
    }
}

function App() {
    const [origin, setOrigin] = useState<LocationPoint | null>(null);
    const [destination, setDestination] = useState<LocationPoint | null>(null);
    const [activeMode, setActiveMode] = useState<InputMode>('ORIGIN');
    const [snapState, setSnapState] = useState<SnapState>('COLLAPSED');
    const [trip, setTrip] = useState<TripPlan | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [locatingOrigin, setLocatingOrigin] = useState<boolean>(false);
    const [locationError, setLocationError] = useState<string | null>(null);

    // Live Turn-by-Turn Navigation States (Real GPS first; simulation is optional)
    const [isNavigating, setIsNavigating] = useState<boolean>(false);
    const [currentLegIndex, setCurrentLegIndex] = useState<number>(0);
    const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
    const [userBearing, setUserBearing] = useState<number>(0);
    const [followUser, setFollowUser] = useState<boolean>(true);
    const [isSimulating, setIsSimulating] = useState<boolean>(false);
    const [gpsStatus, setGpsStatus] = useState<GpsNavStatus>('IDLE');
    const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
    const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);
    const [gpsSpeedKmh, setGpsSpeedKmh] = useState<number | null>(null);
    const [showNavStepList, setShowNavStepList] = useState<boolean>(false);
    const simCoordIdxRef = useRef<number>(0);
    const lastGpsPointRef = useRef<[number, number] | null>(null);

    // Stable state refs to prevent re-creation of handlers
    const activeModeRef = useRef(activeMode);
    activeModeRef.current = activeMode;
    const originRef = useRef(origin);
    originRef.current = origin;
    const destinationRef = useRef(destination);
    destinationRef.current = destination;

    // Fetch optimal transit trip plan when both origin and destination are set
    const fetchTripPlan = useCallback(async (start: LocationPoint, end: LocationPoint) => {
        setLoading(true);
        setErrorMsg(null);
        try {
            const params = new URLSearchParams({
                origin_lng: String(start.coords[0]),
                origin_lat: String(start.coords[1]),
                dest_lng: String(end.coords[0]),
                dest_lat: String(end.coords[1]),
            });

            const res = await fetch(`${API_BASE}/api/routing/plan?${params}`);
            const data = await res.json();

            if (!res.ok) {
                setErrorMsg(data.detail || 'No public transit route found between these points');
                setTrip(null);
                setSnapState('COLLAPSED');
                return;
            }

            setTrip(data);
            setSnapState('COLLAPSED'); // Default to bottom glance bar so the map is clearly visible!
        } catch (err: unknown) {
            setErrorMsg(
                err instanceof Error
                    ? err.message
                    : 'Unable to connect to Bandung Transit routing engine'
            );
            setTrip(null);
            setSnapState('COLLAPSED');
        } finally {
            setLoading(false);
        }
    }, []);

    // Trigger trip planning whenever both endpoints exist
    useEffect(() => {
        if (origin && destination) {
            fetchTripPlan(origin, destination);
        } else {
            setTrip(null);
            setErrorMsg(null);
            setIsNavigating(false);
            setIsSimulating(false);
        }
    }, [origin, destination, fetchTripPlan]);

    // Handle map clicks (smooth, zero stuttering or map recreation)
    const handleMapClick = useCallback((coords: [number, number], name?: string) => {
        // When in navigation mode, map click can test setting user location directly!
        if (isNavigating) {
            setUserLocation(coords);
            setFollowUser(true);
            return;
        }

        const pointLabel: LocationPoint = {
            coords,
            name: name || `Dropped Pin (${coords[0].toFixed(4)}, ${coords[1].toFixed(4)})`,
        };

        if (activeModeRef.current === 'ORIGIN') {
            setOrigin(pointLabel);
            if (!destinationRef.current) {
                setActiveMode('DEST');
            }
        } else {
            setDestination(pointLabel);
            if (!originRef.current) {
                setActiveMode('ORIGIN');
            }
        }
    }, [isNavigating]);

    // Handle preset landmark selection
    const handleSelectPreset = useCallback((preset: LocationPoint) => {
        if (activeModeRef.current === 'ORIGIN') {
            setOrigin(preset);
            setLocationError(null);
            if (!destinationRef.current) {
                setActiveMode('DEST');
            }
        } else {
            setDestination(preset);
            if (!originRef.current) {
                setActiveMode('ORIGIN');
            }
        }
    }, []);

    // Use device GPS current location as Pickup Point (A)
    const handleUseCurrentLocation = useCallback(() => {
        setLocationError(null);

        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setLocationError('Browser ini tidak mendukung deteksi lokasi GPS.');
            return;
        }

        setLocatingOrigin(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                // Strictly [longitude, latitude] per GeoJSON & PostGIS convention
                const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
                const initialPoint: LocationPoint = {
                    coords,
                    name: 'Lokasi Saya Saat Ini',
                    description: 'Mendeteksi nama jalan...',
                };

                setUserLocation(coords);
                setOrigin(initialPoint);
                setLocatingOrigin(false);

                if (!destinationRef.current) {
                    setActiveMode('DEST');
                }

                // Enrich pickup label via reverse geocoding without blocking map pan / routing
                reverseGeocodePickup(coords).then(({ name, description }) => {
                    setOrigin((prev) => {
                        if (
                            prev &&
                            prev.coords[0] === coords[0] &&
                            prev.coords[1] === coords[1]
                        ) {
                            return { ...prev, name, description };
                        }
                        return prev;
                    });
                });
            },
            (err) => {
                setLocatingOrigin(false);
                const isInsecureLan =
                    typeof window !== 'undefined' &&
                    !window.isSecureContext &&
                    window.location.hostname !== 'localhost' &&
                    window.location.hostname !== '127.0.0.1';

                if (err.code === err.PERMISSION_DENIED) {
                    setLocationError(
                        isInsecureLan
                            ? 'GPS diblokir browser pada koneksi HTTP jaringan lokal. Aktifkan izin origin di browser atau ketuk peta untuk memilih titik jemput.'
                            : 'Izin lokasi ditolak. Aktifkan izin lokasi browser lalu coba lagi.'
                    );
                } else if (err.code === err.POSITION_UNAVAILABLE) {
                    setLocationError('Sinyal lokasi tidak tersedia. Pastikan GPS perangkat aktif.');
                } else if (err.code === err.TIMEOUT) {
                    setLocationError('Waktu deteksi GPS habis. Coba lagi atau ketuk peta.');
                } else {
                    setLocationError('Gagal mengambil lokasi saat ini.');
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 15000,
            }
        );
    }, []);

    // Swap pickup and dropoff
    const handleSwap = useCallback(() => {
        setOrigin((prevOrigin) => {
            setDestination(prevOrigin);
            return destinationRef.current;
        });
    }, []);

    // Clear origin
    const handleClearOrigin = useCallback(() => {
        setOrigin(null);
        setTrip(null);
        setIsNavigating(false);
        setActiveMode('ORIGIN');
    }, []);

    // Clear destination
    const handleClearDestination = useCallback(() => {
        setDestination(null);
        setTrip(null);
        setIsNavigating(false);
        setActiveMode('DEST');
    }, []);

    // Reset entire trip
    const handleResetTrip = useCallback(() => {
        setOrigin(null);
        setDestination(null);
        setTrip(null);
        setErrorMsg(null);
        setIsNavigating(false);
        setIsSimulating(false);
        setActiveMode('ORIGIN');
        setSnapState('COLLAPSED');
    }, []);

    // Start Live Navigation Mode (Real GPS by default; simulation can be toggled optionally)
    const handleStartNavigation = useCallback(() => {
        if (!trip || !origin) return;
        setIsNavigating(true);
        setIsSimulating(false);
        setCurrentLegIndex(0);
        simCoordIdxRef.current = 0;
        lastGpsPointRef.current = null;
        setGpsStatus('SEARCHING');
        setGpsErrorMsg(null);
        setGpsAccuracy(null);
        setGpsSpeedKmh(null);
        setUserLocation((prev) => prev || origin.coords);
        setUserBearing(0);
        setFollowUser(true);
    }, [trip, origin]);

    // Exit Live Navigation Mode
    const handleExitNavigation = useCallback(() => {
        setIsNavigating(false);
        setIsSimulating(false);
        setGpsStatus('IDLE');
        setGpsErrorMsg(null);
        setGpsAccuracy(null);
        setGpsSpeedKmh(null);
        lastGpsPointRef.current = null;
        setFollowUser(true);
        setUserLocation(null);
        setSnapState('COLLAPSED');
    }, []);

    // Toggle between Real GPS and Demo Simulation during live navigation
    const handleToggleSimulate = useCallback(() => {
        setIsSimulating((prev) => {
            const next = !prev;
            if (next) {
                setGpsStatus('SIMULATED');
                setGpsErrorMsg(null);
                simCoordIdxRef.current = 0;
                const leg = trip?.legs?.[currentLegIndex];
                const coords = getLegCoordinates(leg);
                if (coords.length > 0) {
                    setUserLocation(coords[0]);
                }
            } else {
                setGpsStatus('SEARCHING');
                setGpsErrorMsg(null);
            }
            setFollowUser(true);
            return next;
        });
    }, [trip, currentLegIndex]);

    // Reroute from live GPS position when user goes off-route
    const handleRerouteFromCurrentLocation = useCallback(() => {
        if (!userLocation || !destination) return;
        const newOrigin: LocationPoint = {
            coords: userLocation,
            name: 'Lokasi Saya Saat Ini',
            description: 'Rute ulang dari posisi GPS aktif',
        };
        setOrigin(newOrigin);
        setCurrentLegIndex(0);
        simCoordIdxRef.current = 0;
        setFollowUser(true);
    }, [userLocation, destination]);

    // Step Forward Navigation
    const handleNextStep = useCallback(() => {
        if (!trip) return;
        setCurrentLegIndex((prev) => {
            const nextIdx = Math.min(prev + 1, trip.legs.length);
            simCoordIdxRef.current = 0;
            const nextLeg = trip.legs[nextIdx];
            if (nextLeg) {
                const coords = getLegCoordinates(nextLeg);
                if (coords.length > 0) {
                    setUserLocation(coords[0]);
                }
            } else if (destination) {
                setUserLocation(destination.coords);
            }
            return nextIdx;
        });
        setFollowUser(true);
    }, [trip, destination]);

    // Step Backward Navigation
    const handlePrevStep = useCallback(() => {
        if (!trip) return;
        setCurrentLegIndex((prev) => {
            const prevIdx = Math.max(0, prev - 1);
            simCoordIdxRef.current = 0;
            const prevLeg = trip.legs[prevIdx];
            if (prevLeg) {
                const coords = getLegCoordinates(prevLeg);
                if (coords.length > 0) {
                    setUserLocation(coords[0]);
                }
            }
            return prevIdx;
        });
        setFollowUser(true);
    }, [trip]);

    // Recenter map camera to user position
    const handleRecenter = useCallback(() => {
        setFollowUser(true);
    }, []);

    // Real GPS Watcher (Active by default during Live Navigation when not simulating)
    useEffect(() => {
        if (!isNavigating || isSimulating) return;

        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setGpsStatus('ERROR');
            setGpsErrorMsg('Browser ini tidak mendukung GPS real-time.');
            return;
        }

        setGpsStatus('SEARCHING');
        setGpsErrorMsg(null);

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                // Strictly [longitude, latitude] per GeoJSON & PostGIS convention
                const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
                setUserLocation(coords);
                setGpsStatus('LOCKED');
                setGpsErrorMsg(null);
                setGpsAccuracy(
                    typeof pos.coords.accuracy === 'number' && !isNaN(pos.coords.accuracy)
                        ? pos.coords.accuracy
                        : null
                );

                const speedMs =
                    typeof pos.coords.speed === 'number' && !isNaN(pos.coords.speed) && pos.coords.speed >= 0
                        ? pos.coords.speed
                        : null;
                setGpsSpeedKmh(speedMs !== null ? speedMs * 3.6 : null);

                // Prefer device compass/GPS heading when moving; otherwise derive smooth bearing from >=4m movement
                if (
                    pos.coords.heading !== null &&
                    !isNaN(pos.coords.heading) &&
                    (speedMs === null || speedMs >= 0.6)
                ) {
                    setUserBearing(pos.coords.heading);
                } else if (lastGpsPointRef.current) {
                    const movedM = haversineMeters(lastGpsPointRef.current, coords);
                    if (movedM >= 4) {
                        setUserBearing(calculateBearing(lastGpsPointRef.current, coords));
                    }
                }
                lastGpsPointRef.current = coords;
            },
            (err) => {
                setGpsStatus('ERROR');
                const isInsecureLan =
                    typeof window !== 'undefined' &&
                    !window.isSecureContext &&
                    window.location.hostname !== 'localhost' &&
                    window.location.hostname !== '127.0.0.1';

                if (err.code === err.PERMISSION_DENIED) {
                    setGpsErrorMsg(
                        isInsecureLan
                            ? 'GPS real-time butuh HTTPS pada jaringan lokal (jalankan npm run dev:https) atau gunakan Simulasi.'
                            : 'Izin GPS ditolak. Aktifkan izin lokasi browser untuk navigasi real-time.'
                    );
                } else if (err.code === err.POSITION_UNAVAILABLE) {
                    setGpsErrorMsg('Sinyal GPS belum tersedia. Pastikan GPS perangkat aktif.');
                } else if (err.code === err.TIMEOUT) {
                    setGpsErrorMsg('Sinyal GPS lambat merespons. Mencoba ulang di area terbuka...');
                } else {
                    setGpsErrorMsg('Gagal membaca lokasi GPS perangkat.');
                }
            },
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        );

        return () => {
            navigator.geolocation.clearWatch(watchId);
        };
    }, [isNavigating, isSimulating]);

    // Evaluate live navigation progress (geofenced auto-leg progression, live distance/ETA, off-route, alighting alert)
    const navProgress = useMemo(() => {
        if (!trip || !trip.legs) {
            return {
                shouldAdvanceLeg: false,
                arrivedAtDestination: false,
                remainingLegMeters: 0,
                remainingTotalMeters: 0,
                remainingTotalMinutes: 0,
                offRoute: false,
                distanceOffRouteMeters: 0,
                approachingCheckpoint: false,
            };
        }
        return evaluateNavigationProgress(
            userLocation,
            trip.legs,
            currentLegIndex,
            isSimulating ? 5 : gpsAccuracy
        );
    }, [trip, userLocation, currentLegIndex, isSimulating, gpsAccuracy]);

    // Auto-advance legs in Real GPS mode when user reaches a boarding stop, alighting stop, or destination
    useEffect(() => {
        if (!isNavigating || isSimulating || !trip || gpsStatus !== 'LOCKED') return;
        if (navProgress.arrivedAtDestination) {
            setCurrentLegIndex(trip.legs.length);
        } else if (navProgress.shouldAdvanceLeg && currentLegIndex < trip.legs.length - 1) {
            setCurrentLegIndex((prev) => prev + 1);
        }
    }, [
        isNavigating,
        isSimulating,
        trip,
        gpsStatus,
        navProgress.shouldAdvanceLeg,
        navProgress.arrivedAtDestination,
        currentLegIndex,
    ]);

    // Smooth Route Simulation Ticker (Walks & rides along geometries)
    useEffect(() => {
        if (!isNavigating || !isSimulating || !trip) return;

        const currentLeg = trip.legs[currentLegIndex];
        if (!currentLeg) {
            setIsSimulating(false);
            return;
        }

        const coords = getLegCoordinates(currentLeg);
        if (coords.length === 0) return;

        // Interval pace: 350ms per vertex
        const intervalId = setInterval(() => {
            simCoordIdxRef.current += 1;
            const idx = simCoordIdxRef.current;

            if (idx < coords.length) {
                const curPoint = coords[idx];
                const prevPoint = coords[idx - 1] || curPoint;
                const bearing = calculateBearing(prevPoint, curPoint);

                setUserLocation(curPoint);
                setUserBearing(bearing);
            } else {
                // Reached the end of this leg, advance to next leg!
                if (currentLegIndex < trip.legs.length - 1) {
                    simCoordIdxRef.current = 0;
                    setCurrentLegIndex((prev) => prev + 1);
                } else {
                    // Entire journey completed!
                    setIsSimulating(false);
                    setCurrentLegIndex(trip.legs.length);
                    if (destination) {
                        setUserLocation(destination.coords);
                    }
                }
            }
        }, 400);

        return () => {
            clearInterval(intervalId);
        };
    }, [isNavigating, isSimulating, trip, currentLegIndex, destination]);

    const remainingMinutes = navProgress.remainingTotalMinutes;
    const remainingMeters = navProgress.remainingTotalMeters;

    return (
        <div className="relative w-full h-[100dvh] overflow-hidden bg-slate-900 select-none">
            {/* Full-bleed Map Canvas */}
            <TransitMap
                origin={origin}
                destination={destination}
                trip={trip}
                onMapClick={handleMapClick}
                snapState={snapState}
                isNavigating={isNavigating}
                userLocation={userLocation}
                userBearing={userBearing}
                followUser={followUser}
                onUserDrag={() => setFollowUser(false)}
            />

            {/* Top Area: Planning Header OR Live Navigation Header */}
            {!isNavigating ? (
                <div className="pointer-events-none absolute top-3 left-3 right-3 md:top-6 md:left-6 md:right-auto md:w-[420px] z-30 flex flex-col gap-3 max-h-[calc(100dvh-48px)]">
                    {/* Floating Ride-Hailing Search Header with Typeable Inputs & Autocomplete */}
                    <RidehailSearchHeader
                        origin={origin}
                        destination={destination}
                        activeMode={activeMode}
                        onSelectMode={setActiveMode}
                        onSwap={handleSwap}
                        onClearOrigin={handleClearOrigin}
                        onClearDestination={handleClearDestination}
                        onSelectPreset={handleSelectPreset}
                        onUseCurrentLocation={handleUseCurrentLocation}
                        locatingOrigin={locatingOrigin}
                        locationError={locationError}
                        onClearLocationError={() => setLocationError(null)}
                        loading={loading}
                        routeError={errorMsg}
                    />

                    {/* Desktop Bottom Sheet (Left Floating Panel) - Sits naturally below with gap-3 */}
                    <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0 w-full pointer-events-auto overflow-hidden">
                        <RidehailBottomSheet
                            trip={trip}
                            origin={origin}
                            destination={destination}
                            loading={loading}
                            errorMsg={errorMsg}
                            onResetTrip={handleResetTrip}
                            snapState={snapState}
                            onChangeSnapState={setSnapState}
                            onStartNavigation={handleStartNavigation}
                        />
                    </div>
                </div>
            ) : (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-start justify-start">
                    {/* Live Google Maps-Style Turn-by-Turn Navigation Header */}
                    <LiveNavigationHeader
                        trip={trip!}
                        currentLegIndex={currentLegIndex}
                        userLocation={userLocation}
                        isSimulating={isSimulating}
                        gpsStatus={isSimulating ? 'SIMULATED' : gpsStatus}
                        gpsAccuracy={gpsAccuracy}
                        gpsErrorMsg={gpsErrorMsg}
                        remainingLegMeters={navProgress.remainingLegMeters}
                        offRoute={navProgress.offRoute}
                        distanceOffRouteMeters={navProgress.distanceOffRouteMeters}
                        approachingCheckpoint={navProgress.approachingCheckpoint}
                        onToggleSimulate={handleToggleSimulate}
                        onNextStep={handleNextStep}
                        onPrevStep={handlePrevStep}
                        onExitNavigation={handleExitNavigation}
                        onRerouteFromCurrentLocation={handleRerouteFromCurrentLocation}
                    />
                </div>
            )}

            {/* Bottom Area: Planning Bottom Sheet OR Live Navigation Footer */}
            {!isNavigating ? (
                /* Mobile Planning Bottom Sheet */
                <div className="md:hidden">
                    <RidehailBottomSheet
                        trip={trip}
                        origin={origin}
                        destination={destination}
                        loading={loading}
                        errorMsg={errorMsg}
                        onResetTrip={handleResetTrip}
                        snapState={snapState}
                        onChangeSnapState={setSnapState}
                        onStartNavigation={handleStartNavigation}
                    />
                </div>
            ) : (
                /* Live Turn-by-Turn Bottom Glance Bar */
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 md:p-6 md:flex md:flex-col md:items-start">
                    <LiveNavigationFooter
                        trip={trip!}
                        currentLegIndex={currentLegIndex}
                        remainingMinutes={remainingMinutes}
                        remainingMeters={remainingMeters}
                        gpsSpeedKmh={gpsSpeedKmh}
                        isSimulating={isSimulating}
                        onRecenter={handleRecenter}
                        onExitNavigation={handleExitNavigation}
                        showStepList={showNavStepList}
                        onToggleStepList={() => setShowNavStepList((prev) => !prev)}
                    />

                    {/* Step list popover inside navigation mode */}
                    {showNavStepList && (
                        <div className="pointer-events-auto w-full max-w-md mx-auto mb-2 px-3 md:px-0">
                            <div className="bg-white/95 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-2xl p-4 max-h-[50vh] overflow-y-auto">
                                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">
                                    Daftar Langkah Perjalanan
                                </h4>
                                <div className="space-y-2">
                                    {trip!.legs.map((leg, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => {
                                                setCurrentLegIndex(idx);
                                                simCoordIdxRef.current = 0;
                                                const c = getLegCoordinates(leg);
                                                if (c.length > 0) setUserLocation(c[0]);
                                                setFollowUser(true);
                                            }}
                                            className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                                                idx === currentLegIndex
                                                    ? 'bg-emerald-50 border-emerald-400 font-bold text-emerald-950'
                                                    : idx < currentLegIndex
                                                    ? 'bg-slate-50 border-slate-200 text-slate-400'
                                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span>Langkah {idx + 1}: {leg.type}</span>
                                                <span>{Math.round(leg.duration_seconds / 60)} mnt</span>
                                            </div>
                                            <p className="text-[11px] mt-0.5 truncate font-normal">
                                                {leg.instruction || `${leg.corridor_name} (${leg.board_stop} ➔ ${leg.alight_stop})`}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;
