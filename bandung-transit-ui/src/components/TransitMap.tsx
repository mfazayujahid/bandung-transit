import { useEffect, useRef, useState, useCallback } from 'react';
import {
    Map as MapLibreMap,
    GeoJSONSource,
    LngLatBounds,
    setWorkerUrl,
    type MapMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature } from 'geojson';
import { Crosshair, Layers, Maximize2 } from 'lucide-react';
import type { LocationPoint, SnapState, TripPlan } from '../types/transit';
import { VehicleAnimator } from '../utils/vehicleAnimator';
import { API_BASE, WS_BASE } from '../utils/apiConfig';

setWorkerUrl(workerUrl);

interface TransitMapProps {
    origin: LocationPoint | null;
    destination: LocationPoint | null;
    trip: TripPlan | null;
    onMapClick: (coords: [number, number], name?: string) => void;
    snapState: SnapState;
    isNavigating?: boolean;
    userLocation?: [number, number] | null;
    userBearing?: number;
    followUser?: boolean;
    onUserDrag?: () => void;
}

export function TransitMap({
    origin,
    destination,
    trip,
    onMapClick,
    snapState,
    isNavigating = false,
    userLocation = null,
    userBearing = 0,
    followUser = true,
    onUserDrag,
}: TransitMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MapLibreMap | null>(null);
    const [isMapLoaded, setIsMapLoaded] = useState(false);
    const [corridorsVisible, setCorridorsVisible] = useState(true);

    // Keep onMapClick in a ref so the map is never recreated when parent callback changes
    const onMapClickRef = useRef(onMapClick);
    useEffect(() => {
        onMapClickRef.current = onMapClick;
    }, [onMapClick]);

    const onUserDragRef = useRef(onUserDrag);
    useEffect(() => {
        onUserDragRef.current = onUserDrag;
    }, [onUserDrag]);

    // Compute dynamic camera padding based on viewport size & bottom sheet / sidebar
    const computePadding = useCallback(() => {
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            let bottomPadding = 110;
            if (snapState === 'HALF') bottomPadding = window.innerHeight * 0.52;
            else if (snapState === 'FULL') bottomPadding = window.innerHeight * 0.85;

            return { top: 70, bottom: bottomPadding + 15, left: 20, right: 20 };
        } else {
            // Desktop floating sidebar takes 440px on left
            return { top: 40, bottom: 40, left: 470, right: 40 };
        }
    }, [snapState]);

    // Fit map camera bounds to active trip or selected pins
    const fitCameraToTrip = useCallback(() => {
        const map = mapRef.current;
        if (!map) return;

        const bounds = new LngLatBounds();
        let hasPoints = false;

        if (origin) {
            bounds.extend(origin.coords);
            hasPoints = true;
        }
        if (destination) {
            bounds.extend(destination.coords);
            hasPoints = true;
        }

        if (trip && trip.legs.length > 0) {
            for (const leg of trip.legs) {
                if (leg.geometry && leg.geometry.coordinates) {
                    for (const coord of leg.geometry.coordinates) {
                        bounds.extend(coord as [number, number]);
                        hasPoints = true;
                    }
                }
                if (leg.from_coords) {
                    bounds.extend(leg.from_coords);
                    hasPoints = true;
                }
                if (leg.to_coords) {
                    bounds.extend(leg.to_coords);
                    hasPoints = true;
                }
                if (leg.stop_coords) {
                    for (const sc of leg.stop_coords) {
                        bounds.extend(sc);
                        hasPoints = true;
                    }
                }
            }
        }

        if (hasPoints) {
            map.fitBounds(bounds, {
                padding: computePadding(),
                maxZoom: 15.5,
                duration: 900,
            });
        }
    }, [origin, destination, trip, computePadding]);

    // 1. Initialize MapLibre GL map instance
    useEffect(() => {
        if (!containerRef.current) return;

        let isMounted = true;

        const map = new MapLibreMap({
            container: containerRef.current,
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [107.6191, -6.9175], // Central Bandung
            zoom: 12.3,
            attributionControl: false,
        });
        mapRef.current = map;
        if (import.meta.env.DEV) {
            (window as any)._transitMap = map;
        }

        map.on('load', () => {
            if (!isMounted) return;

            // Background Corridors Source & Layer (BRT lines + Commuter Line)
            map.addSource('all-corridors', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'all-corridors-layer',
                type: 'line',
                source: 'all-corridors',
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#94a3b8'],
                    'line-width': 2.5,
                    'line-opacity': 0.28,
                },
            });

            // Dedicated Railway Track Styling for Commuter Line (Navy casing + white railroad ties)
            map.addLayer({
                id: 'railway-track-casing',
                type: 'line',
                source: 'all-corridors',
                filter: ['==', ['get', 'code'], 'CLR'],
                paint: {
                    'line-color': '#1e3a8a',
                    'line-width': 5,
                    'line-opacity': 0.75,
                },
            });
            map.addLayer({
                id: 'railway-track-ties',
                type: 'line',
                source: 'all-corridors',
                filter: ['==', ['get', 'code'], 'CLR'],
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 2.5,
                    'line-dasharray': [1, 2],
                    'line-opacity': 0.9,
                },
            });

            // Fetch background corridors
            fetch(`${API_BASE}/api/transit/corridors`)
                .then(async (res) => {
                    if (!res.ok) return;
                    const data = await res.json();
                    if (!isMounted) return;
                    (map.getSource('all-corridors') as GeoJSONSource | undefined)?.setData(data);
                })
                .catch(() => {});

            // Load custom bus shelter icon into MapLibre
            const shelterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
              <rect x="2" y="2" width="32" height="32" rx="9" fill="#ffffff" stroke="#64748b" stroke-width="1.5"/>
              <rect x="4.5" y="4.5" width="27" height="27" rx="7" fill="#0f172a"/>
              <path d="M7.5 11.5h21l-2-3.5H9.5z" fill="#38bdf8"/>
              <rect x="10.5" y="11.5" width="2.2" height="12.5" fill="#f8fafc"/>
              <rect x="23.3" y="11.5" width="2.2" height="12.5" fill="#f8fafc"/>
              <rect x="10.5" y="18.5" width="15" height="2.2" rx="0.6" fill="#fbbf24"/>
              <rect x="8.5" y="24" width="19" height="2" rx="0.5" fill="#64748b"/>
            </svg>`;
            const shelterImg = new Image(36, 36);
            shelterImg.onload = () => {
                if (!map.hasImage('shelter-icon')) {
                    map.addImage('shelter-icon', shelterImg);
                }
            };
            shelterImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shelterSvg);

            // Load custom railway station icon into MapLibre (Crisp White Architectural Station Building Badge)
            const stationSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">
              <rect x="2" y="2" width="34" height="34" rx="9" fill="#ffffff" stroke="#1e3a8a" stroke-width="2.5"/>
              <!-- Station Pitched Canopy Roof -->
              <path d="M7.5 16.5L19 8.5l11.5 8h-3v10.5h-17V16.5z" fill="#e0e7ff"/>
              <path d="M6.5 16.5L19 7.8l12.5 8.7" fill="none" stroke="#1e3a8a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
              <!-- Central Station Clock -->
              <circle cx="19" cy="14" r="2.2" fill="#1e3a8a"/>
              <circle cx="19" cy="14" r="0.9" fill="#fbbf24"/>
              <!-- Station Columns & Arched Main Entrance -->
              <rect x="10.5" y="17.5" width="2.4" height="9.5" fill="#1e3a8a"/>
              <rect x="25.1" y="17.5" width="2.4" height="9.5" fill="#1e3a8a"/>
              <path d="M15.5 27v-5.5a3.5 3.5 0 0 1 7 0V27z" fill="#1e3a8a"/>
              <!-- Platform Base -->
              <rect x="7" y="27" width="24" height="2.8" rx="1.2" fill="#0284c7"/>
            </svg>`;
            const stationImg = new Image(38, 38);
            stationImg.onload = () => {
                if (!map.hasImage('station-icon')) {
                    map.addImage('station-icon', stationImg);
                }
            };
            stationImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(stationSvg);

            // Load custom live train icon into MapLibre (Vibrant KAI Orange Moving Train Puck)
            const trainPuckSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="19" fill="#ea580c" stroke="#ffffff" stroke-width="3"/>
              <rect x="13" y="10" width="18" height="18" rx="4" fill="#ffffff"/>
              <rect x="15.2" y="12.5" width="13.6" height="7.5" rx="1.8" fill="#1e293b"/>
              <circle cx="16.8" cy="23.3" r="1.8" fill="#f59e0b"/>
              <circle cx="27.2" cy="23.3" r="1.8" fill="#f59e0b"/>
              <path d="M15.5 29.5l-2.2 3.5h3.2l1.6-3.5zM28.5 29.5l2.2 3.5h-3.2l-1.6-3.5z" fill="#fed7aa"/>
            </svg>`;
            const trainPuckImg = new Image(44, 44);
            trainPuckImg.onload = () => {
                if (!map.hasImage('train-puck-icon')) {
                    map.addImage('train-puck-icon', trainPuckImg);
                }
            };
            trainPuckImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(trainPuckSvg);

            // Load custom corridor-branded Live Bus Puck Icons into MapLibre (Distinct BRT Bus Silhouette)
            const busPalette: Record<string, string> = {
                'FD-1': '#22b473',
                'FD-2': '#bd0000',
                K1: '#00a64f',
                K2: '#ed1c24',
                K3: '#562b63',
                K4: '#2e3192',
                K5: '#ec008c',
                K6: '#f04b23',
                default: '#2563eb',
            };
            const createBusPuckSvg = (bgColor: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="17.5" fill="${bgColor}" stroke="#ffffff" stroke-width="2.8"/>
              <!-- Side wing mirrors -->
              <rect x="7.8" y="13.5" width="2.2" height="4.8" rx="0.9" fill="#ffffff"/>
              <rect x="30" y="13.5" width="2.2" height="4.8" rx="0.9" fill="#ffffff"/>
              <!-- Bus Body -->
              <rect x="10.5" y="9.5" width="19" height="19.5" rx="3.2" fill="#ffffff"/>
              <!-- Top LED Route Header -->
              <rect x="13.5" y="11" width="13" height="2" rx="0.8" fill="${bgColor}"/>
              <!-- Wide Panoramic Bus Windshield -->
              <rect x="12.2" y="14" width="15.6" height="7.5" rx="1.4" fill="#0f172a"/>
              <!-- Headlights & Front Grille -->
              <circle cx="14.5" cy="24.5" r="1.6" fill="#f59e0b"/>
              <circle cx="25.5" cy="24.5" r="1.6" fill="#f59e0b"/>
              <rect x="17.5" y="23.8" width="5" height="1.5" rx="0.7" fill="#94a3b8"/>
              <!-- Wheels -->
              <rect x="12" y="28.8" width="3.6" height="2.4" rx="0.9" fill="#0f172a"/>
              <rect x="24.4" y="28.8" width="3.6" height="2.4" rx="0.9" fill="#0f172a"/>
            </svg>`;
            for (const [code, color] of Object.entries(busPalette)) {
                const iconId = `bus-puck-${code}`;
                const img = new Image(40, 40);
                img.onload = () => {
                    if (!map.hasImage(iconId)) {
                        map.addImage(iconId, img);
                    }
                };
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(createBusPuckSvg(color));
            }

            // All Transit Shelters (Halte & Stasiun) Source & Distinct Shelter Layers
            map.addSource('all-shelters', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'all-shelters-icon',
                type: 'symbol',
                source: 'all-shelters',
                layout: {
                    'icon-image': [
                        'match',
                        ['get', 'category'],
                        'Station',
                        'station-icon',
                        'shelter-icon',
                    ],
                    'icon-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 0.45,
                        12, 0.65,
                        14, 0.85,
                    ],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
                paint: {
                    'icon-opacity': 0.85,
                },
            });
            map.addLayer({
                id: 'all-shelters-label',
                type: 'symbol',
                source: 'all-shelters',
                minzoom: 13.5,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 10,
                    'text-offset': [0, 1.4],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2,
                },
            });

            // Fetch all Bandung transit shelters & stations
            fetch(`${API_BASE}/api/transit/stops`)
                .then(async (res) => {
                    if (!res.ok) return;
                    const data = await res.json();
                    if (!isMounted) return;
                    (map.getSource('all-shelters') as GeoJSONSource | undefined)?.setData(data);
                })
                .catch(() => {});

            // Active Trip Walking Layers (Casing + Dotted line)
            map.addSource('trip-walk', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'trip-walk-casing',
                type: 'line',
                source: 'trip-walk',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 7.5,
                    'line-opacity': 0.9,
                },
            });
            map.addLayer({
                id: 'trip-walk-layer',
                type: 'line',
                source: 'trip-walk',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#0284c7', // Sky Blue walking trail
                    'line-width': 4.5,
                    'line-dasharray': [1.2, 2.2],
                },
            });

            // Slightly Visible Incoming Vehicle Approach Route (Vehicle -> Boarding Station/Stop)
            map.addSource('trip-incoming-approach', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'trip-incoming-approach-casing',
                type: 'line',
                source: 'trip-incoming-approach',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 7,
                    'line-opacity': 0.35,
                },
            });
            map.addLayer({
                id: 'trip-incoming-approach-layer',
                type: 'line',
                source: 'trip-incoming-approach',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#ea580c'],
                    'line-width': 4.2,
                    'line-dasharray': [2.2, 2.2],
                    'line-opacity': 0.48,
                },
            });

            // Active Trip Transit Route Layers (White Casing Halo + Solid Colored Route Line)
            map.addSource('trip-bus', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'trip-bus-casing-layer',
                type: 'line',
                source: 'trip-bus',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 9.5,
                    'line-opacity': 0.95,
                },
            });
            map.addLayer({
                id: 'trip-bus-layer',
                type: 'line',
                source: 'trip-bus',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
                    'line-width': 6,
                    'line-opacity': 1,
                },
            });
            map.addLayer({
                id: 'trip-train-ties-layer',
                type: 'line',
                source: 'trip-bus',
                filter: ['==', ['get', 'is_train'], 1],
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 3,
                    'line-dasharray': [1, 2],
                    'line-opacity': 0.9,
                },
            });

            // Intermediate Stops / Stations along the Transit Route (Dots)
            map.addSource('trip-bus-stops', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'trip-bus-stops-layer',
                type: 'circle',
                source: 'trip-bus-stops',
                paint: {
                    'circle-radius': 4.5,
                    'circle-color': '#ffffff',
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': ['coalesce', ['get', 'color'], '#2563eb'],
                },
            });

            // Origin (Point A) and Destination (Point B) Pins
            map.addSource('trip-endpoints', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'trip-endpoints-layer',
                type: 'circle',
                source: 'trip-endpoints',
                paint: {
                    'circle-radius': 8.5,
                    'circle-color': ['match', ['get', 'role'], 'ORIGIN', '#10b981', '#ef4444'],
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#ffffff',
                },
            });
            map.addLayer({
                id: 'trip-endpoints-label',
                type: 'symbol',
                source: 'trip-endpoints',
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 11,
                    'text-offset': [0, 1.4],
                    'text-anchor': 'top',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2,
                },
            });

            // Station / Halte Pins (Boarding & Alighting)
            map.addSource('trip-stations', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'trip-stations-layer',
                type: 'circle',
                source: 'trip-stations',
                paint: {
                    'circle-radius': 9,
                    'circle-color': ['match', ['get', 'role'], 'BOARD', '#2563eb', '#e11d48'],
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#ffffff',
                },
            });
            map.addLayer({
                id: 'trip-stations-label',
                type: 'symbol',
                source: 'trip-stations',
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 11,
                    'text-offset': [0, -1.6],
                    'text-anchor': 'bottom',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2.5,
                },
            });

            // Live Incoming Target Vehicle Radar Halo Layer (for bus or train)
            map.addSource('live-bus-incoming', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'live-bus-incoming-halo',
                type: 'circle',
                source: 'live-bus-incoming',
                paint: {
                    'circle-radius': 18,
                    'circle-color': '#10b981',
                    'circle-opacity': 0.35,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#10b981',
                },
            });

            // Real-time Buses Layer (Custom Corridor-Branded Bus Puck Icons)
            map.addSource('live-buses', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'live-buses-layer',
                type: 'symbol',
                source: 'live-buses',
                layout: {
                    'icon-image': ['coalesce', ['get', 'icon_name'], 'bus-puck-default'],
                    'icon-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, ['match', ['coalesce', ['get', 'is_target'], 0], 1, 0.72, 0.45],
                        13, ['match', ['coalesce', ['get', 'is_target'], 0], 1, 0.85, 0.62],
                        16, ['match', ['coalesce', ['get', 'is_target'], 0], 1, 0.98, 0.78],
                    ],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
                paint: {
                    'icon-opacity': 0.95,
                },
            });
            map.addLayer({
                id: 'live-buses-label',
                type: 'symbol',
                source: 'live-buses',
                minzoom: 13.0,
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 10,
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-offset': [0, 1.55],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                },
                paint: {
                    'text-color': '#0f172a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2.2,
                },
            });

            // Real-Time Commuter Trains Layer (Moving Train Pucks with Train Code)
            map.addSource('live-trains', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'live-trains-icon',
                type: 'symbol',
                source: 'live-trains',
                layout: {
                    'icon-image': 'train-puck-icon',
                    'icon-size': 0.78,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
                paint: {
                    'icon-opacity': 0.95,
                },
            });
            map.addLayer({
                id: 'live-trains-label',
                type: 'symbol',
                source: 'live-trains',
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 10.5,
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-offset': [0, 1.7],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                },
                paint: {
                    'text-color': '#c2410c',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2.5,
                },
            });

            // Real-Time User Location Puck Layers (Blue Dot + Radar Ring for Navigation Mode)
            map.addSource('user-location', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer({
                id: 'user-location-halo',
                type: 'circle',
                source: 'user-location',
                paint: {
                    'circle-radius': 19,
                    'circle-color': '#2563eb',
                    'circle-opacity': 0.25,
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#3b82f6',
                },
            });
            map.addLayer({
                id: 'user-location-dot',
                type: 'circle',
                source: 'user-location',
                paint: {
                    'circle-radius': 8.5,
                    'circle-color': '#2563eb',
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#ffffff',
                },
            });
            map.addLayer({
                id: 'user-location-label',
                type: 'symbol',
                source: 'user-location',
                layout: {
                    'text-field': '📍 Posisi Anda',
                    'text-size': 10,
                    'text-offset': [0, 1.4],
                    'text-anchor': 'top',
                    'text-allow-overlap': true,
                },
                paint: {
                    'text-color': '#1d4ed8',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2,
                },
            });

            // Detect user drag on the map to pause follow-cam mode
            map.on('dragstart', () => {
                onUserDragRef.current?.();
            });

            // Handle clicking directly on any shelter/station icon
            map.on('click', 'all-shelters-icon', (e: any) => {
                if (!e.features || e.features.length === 0) return;
                const f = e.features[0];
                const coords = (f.geometry as any).coordinates as [number, number];
                const name = f.properties?.name || 'Halte';
                onMapClickRef.current?.(coords, name);
            });
            map.on('mouseenter', 'all-shelters-icon', () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'all-shelters-icon', () => {
                map.getCanvas().style.cursor = '';
            });

            // Handle user map clicks (general dropped pin, avoiding shelter double click)
            map.on('click', (e: MapMouseEvent) => {
                const shelterHits = map.queryRenderedFeatures(e.point, { layers: ['all-shelters-icon'] });
                if (shelterHits && shelterHits.length > 0) return;
                onMapClickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
            });

            setIsMapLoaded(true);
        });

        return () => {
            isMounted = false;
            map.remove();
            mapRef.current = null;
            setIsMapLoaded(false);
        };
    }, []); // Map is initialized ONCE on mount and never recreated on re-renders!

    // 2. Synchronize Trip Geometries, Isolated Route, and Pins whenever data changes
    useEffect(() => {
        if (!isMapLoaded || !mapRef.current) return;
        const map = mapRef.current;

        // Auto-isolate corridor: Hide background corridors when trip is active!
        if (import.meta.env.DEV) {
            (window as any)._lastTrip = trip;
        }
        if (map.getLayer('all-corridors-layer')) {
            const shouldShow = trip ? false : corridorsVisible;
            map.setLayoutProperty(
                'all-corridors-layer',
                'visibility',
                shouldShow ? 'visible' : 'none'
            );
        }
        if (map.getLayer('railway-track-casing')) {
            const shouldShow = trip ? false : corridorsVisible;
            map.setLayoutProperty(
                'railway-track-casing',
                'visibility',
                shouldShow ? 'visible' : 'none'
            );
            map.setLayoutProperty(
                'railway-track-ties',
                'visibility',
                shouldShow ? 'visible' : 'none'
            );
        }

        // Make the rest of the shelter/station and background vehicle icons less visible when journey is active!
        const hasJourney = Boolean(trip || (origin && destination));
        if (map.getLayer('all-shelters-icon')) {
            map.setPaintProperty(
                'all-shelters-icon',
                'icon-opacity',
                hasJourney ? 0.08 : 0.85
            );
        }
        if (map.getLayer('all-shelters-label')) {
            map.setLayoutProperty(
                'all-shelters-label',
                'visibility',
                hasJourney ? 'none' : (corridorsVisible ? 'visible' : 'none')
            );
        }

        // Keep active journey corridor vehicles clearly visible while dimming unrelated corridors
        if (map.getLayer('live-buses-layer')) {
            map.setPaintProperty(
                'live-buses-layer',
                'icon-opacity',
                hasJourney
                    ? [
                          'case',
                          ['==', ['coalesce', ['get', 'is_target'], 0], 1],
                          1.0,
                          ['==', ['coalesce', ['get', 'on_trip_corridor'], 0], 1],
                          0.82,
                          0.12,
                      ]
                    : 0.95
            );
        }
        if (map.getLayer('live-buses-label')) {
            map.setPaintProperty(
                'live-buses-label',
                'text-opacity',
                hasJourney
                    ? [
                          'case',
                          ['==', ['coalesce', ['get', 'is_target'], 0], 1],
                          1.0,
                          ['==', ['coalesce', ['get', 'on_trip_corridor'], 0], 1],
                          0.85,
                          0.0,
                      ]
                    : 1.0
            );
        }

        // Keep active commuter line trains visible when journey includes rail, softly dim otherwise
        if (map.getLayer('live-trains-icon')) {
            map.setPaintProperty(
                'live-trains-icon',
                'icon-opacity',
                hasJourney
                    ? [
                          'case',
                          ['==', ['coalesce', ['get', 'is_target'], 0], 1],
                          1.0,
                          ['==', ['coalesce', ['get', 'on_trip_corridor'], 0], 1],
                          0.82,
                          0.15,
                      ]
                    : 0.95
            );
        }
        if (map.getLayer('live-trains-label')) {
            map.setPaintProperty(
                'live-trains-label',
                'text-opacity',
                hasJourney
                    ? [
                          'case',
                          ['==', ['coalesce', ['get', 'is_target'], 0], 1],
                          1.0,
                          ['==', ['coalesce', ['get', 'on_trip_corridor'], 0], 1],
                          0.85,
                          0.0,
                      ]
                    : 1.0
            );
        }

        // 1. Endpoints (Origin & Destination)
        const endpointFeatures: Feature[] = [];
        if (origin) {
            endpointFeatures.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: origin.coords },
                properties: { role: 'ORIGIN', label: `Jemput (A): ${origin.name}` },
            });
        }
        if (destination) {
            endpointFeatures.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: destination.coords },
                properties: { role: 'DEST', label: `Tujuan (B): ${destination.name}` },
            });
        }
        (map.getSource('trip-endpoints') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: endpointFeatures,
        });

        // 2. Trip Route Geometries, Incoming Vehicle Approach Trails & Stations
        const walkFeatures: Feature[] = [];
        const approachFeatures: Feature[] = [];
        const transitFeatures: Feature[] = [];
        const stopFeatures: Feature[] = [];
        const stationFeatures: Feature[] = [];

        if (trip && trip.legs) {
            for (const leg of trip.legs) {
                // Walking Leg (prefers real-world pedestrian road network geometry)
                if (leg.type === 'WALK' || leg.type === 'TRANSFER_WALK') {
                    if (leg.geometry && leg.geometry.coordinates && leg.geometry.coordinates.length > 0) {
                        walkFeatures.push({
                            type: 'Feature',
                            geometry: leg.geometry,
                            properties: {},
                        });
                    } else if (leg.from_coords && leg.to_coords) {
                        walkFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'LineString', coordinates: [leg.from_coords, leg.to_coords] },
                            properties: {},
                        });
                    }
                }
                // Bus or Train Transit Leg
                else if (leg.type === 'BUS' || leg.type === 'TRAIN') {
                    const isTrain = leg.type === 'TRAIN';
                    const legColor = leg.color || (isTrain ? '#1e3a8a' : '#2563eb');

                    if (leg.geometry) {
                        transitFeatures.push({
                            type: 'Feature',
                            geometry: leg.geometry,
                            properties: { color: legColor, is_train: isTrain ? 1 : 0 },
                        });
                    }

                    // Slightly visible approach route of the incoming bus/train toward the boarding stop
                    const approachGeo =
                        leg.incoming_vehicle?.approach_geometry || leg.incoming_bus?.approach_geometry;
                    if (approachGeo && approachGeo.coordinates && approachGeo.coordinates.length >= 2) {
                        approachFeatures.push({
                            type: 'Feature',
                            geometry: approachGeo,
                            properties: {
                                color: isTrain ? '#ea580c' : legColor,
                                is_train: isTrain ? 1 : 0,
                            },
                        });
                    }

                    // Intermediate stops along the route
                    if (leg.stop_coords) {
                        for (const coord of leg.stop_coords) {
                            stopFeatures.push({
                                type: 'Feature',
                                geometry: { type: 'Point', coordinates: coord },
                                properties: { color: legColor },
                            });
                        }
                    }

                    // Boarding Stop/Station Pin
                    const boardCoord = leg.from_coords || (leg.stop_coords && leg.stop_coords[0]);
                    if (boardCoord && leg.board_stop) {
                        stationFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: boardCoord },
                            properties: {
                                role: 'BOARD',
                                label: isTrain ? `🚉 Naik: ${leg.board_stop}` : `🚏 Naik: ${leg.board_stop}`,
                                color: legColor,
                            },
                        });
                    }

                    // Alighting Stop/Station Pin
                    const alightCoord = leg.to_coords || (leg.stop_coords && leg.stop_coords[leg.stop_coords.length - 1]);
                    if (alightCoord && leg.alight_stop) {
                        stationFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: alightCoord },
                            properties: {
                                role: 'ALIGHT',
                                label: isTrain ? `🚉 Turun: ${leg.alight_stop}` : `🚏 Turun: ${leg.alight_stop}`,
                                color: '#e11d48',
                            },
                        });
                    }
                }
            }
        }

        if (import.meta.env.DEV) {
            (window as any)._lastWalkFeatures = walkFeatures;
        }

        (map.getSource('trip-incoming-approach') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: approachFeatures,
        });
        (map.getSource('trip-walk') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: walkFeatures,
        });
        (map.getSource('trip-bus') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: transitFeatures,
        });
        (map.getSource('trip-bus-stops') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: stopFeatures,
        });
        (map.getSource('trip-stations') as GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: stationFeatures,
        });

        // Auto-fit camera when trip changes (only if not actively in turn-by-turn navigation)
        if (!isNavigating && (trip || (origin && destination))) {
            fitCameraToTrip();
        }
    }, [isMapLoaded, origin, destination, trip, corridorsVisible, fitCameraToTrip, isNavigating]);

    // 2.5 User Location Puck & Navigation Camera Follow
    useEffect(() => {
        if (!isMapLoaded || !mapRef.current) return;
        const map = mapRef.current;
        const userSource = map.getSource('user-location') as GeoJSONSource | undefined;
        if (!userSource) return;

        if (import.meta.env.DEV) {
            (window as any)._currentUserLocation = userLocation;
        }

        if (userLocation) {
            userSource.setData({
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: userLocation },
                        properties: { bearing: userBearing || 0 },
                    },
                ],
            });

            if (isNavigating && followUser) {
                map.easeTo({
                    center: userLocation,
                    zoom: 16.8,
                    pitch: 35, // 3D navigation perspective
                    bearing: userBearing || 0,
                    duration: 600,
                });
            } else if (!isNavigating && !destination && !trip) {
                map.flyTo({
                    center: userLocation,
                    zoom: Math.max(map.getZoom(), 15),
                    padding: computePadding(),
                    duration: 900,
                });
            }
        } else {
            userSource.setData({
                type: 'FeatureCollection',
                features: [],
            });
        }
    }, [isMapLoaded, userLocation, userBearing, isNavigating, followUser, destination, trip, computePadding]);

    // Reset camera pitch and re-fit when exiting navigation mode
    const prevNavigatingRef = useRef(isNavigating);
    useEffect(() => {
        if (prevNavigatingRef.current && !isNavigating) {
            if (mapRef.current) {
                mapRef.current.easeTo({
                    pitch: 0,
                    bearing: 0,
                    duration: 600,
                });
                fitCameraToTrip();
            }
        }
        prevNavigatingRef.current = isNavigating;
    }, [isNavigating, fitCameraToTrip]);

    // Keep latest trip in a ref so the persistent WebSocket + 60fps animator never tears down on trip change
    const tripRef = useRef<TripPlan | null>(trip);
    const animatorRef = useRef<VehicleAnimator>(new VehicleAnimator());
    useEffect(() => {
        tripRef.current = trip;
        animatorRef.current.markDirty();
    }, [trip, origin, destination]);

    // 3. Real-Time WebSocket Stream + 60 FPS Smooth Motion Interpolation Engine
    useEffect(() => {
        if (!isMapLoaded || !mapRef.current) return;
        const map = mapRef.current;
        const animator = animatorRef.current;

        let isMounted = true;
        let ws: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let pingTimer: ReturnType<typeof setInterval> | null = null;
        let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
        let rafId: number | null = null;
        let reconnectDelayMs = 1000;

        const metrics = {
            connected: false,
            snapshots: 0,
            busDeltas: 0,
            trainTicks: 0,
            framesRendered: 0,
        };
        if (import.meta.env.DEV) {
            (window as any)._wsMetrics = metrics;
        }

        const pushFrameToMap = () => {
            if (!isMounted || !mapRef.current) return;
            const { busFeatures, trainFeatures, incomingFeatures } = animator.buildFrame(tripRef.current);
            (map.getSource('live-buses') as GeoJSONSource | undefined)?.setData({
                type: 'FeatureCollection',
                features: busFeatures,
            });
            (map.getSource('live-trains') as GeoJSONSource | undefined)?.setData({
                type: 'FeatureCollection',
                features: trainFeatures,
            });
            (map.getSource('live-bus-incoming') as GeoJSONSource | undefined)?.setData({
                type: 'FeatureCollection',
                features: incomingFeatures,
            });
            metrics.framesRendered += 1;
        };

        // Smooth ~30 FPS gliding loop — silky vehicle motion while keeping MapLibre's GeoJSON worker backlog-free
        let lastRenderTs = 0;
        const MIN_FRAME_MS = 33; // ~30 FPS cap prevents GeoJSON worker starvation during pan/zoom
        const animationLoop = (now: number) => {
            if (!isMounted) return;
            if (now - lastRenderTs >= MIN_FRAME_MS && animator.step(now)) {
                lastRenderTs = now;
                pushFrameToMap();
            }
            rafId = requestAnimationFrame(animationLoop);
        };
        rafId = requestAnimationFrame(animationLoop);

        // Graceful REST fallback (only runs if WebSocket is disconnected)
        const fetchRestFallback = async () => {
            if (!isMounted || metrics.connected) return;
            try {
                const [busRes, trainRes] = await Promise.all([
                    fetch(`${API_BASE}/api/transit/buses`),
                    fetch(`${API_BASE}/api/transit/trains`),
                ]);
                if (!isMounted || metrics.connected) return;
                const now = performance.now();
                if (busRes.ok) {
                    const busGeo = await busRes.json();
                    animator.upsertBuses(busGeo.features || [], true, now);
                }
                if (trainRes.ok) {
                    const trainGeo = await trainRes.json();
                    animator.upsertTrains(trainGeo.features || [], now);
                }
            } catch {}
        };

        const connectWebSocket = () => {
            if (!isMounted) return;
            try {
                ws = new WebSocket(`${WS_BASE}/api/transit/ws/live`);
            } catch {
                scheduleReconnect();
                return;
            }

            ws.onopen = () => {
                if (!isMounted) {
                    ws?.close();
                    return;
                }
                metrics.connected = true;
                reconnectDelayMs = 1000;
                if (fallbackPollTimer) {
                    clearInterval(fallbackPollTimer);
                    fallbackPollTimer = null;
                }
                if (pingTimer) clearInterval(pingTimer);
                pingTimer = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send('ping');
                    }
                }, 25000);
            };

            ws.onmessage = (event) => {
                if (!isMounted) return;
                try {
                    const msg = JSON.parse(event.data);
                    const now = performance.now();
                    if (msg.type === 'snapshot') {
                        metrics.snapshots += 1;
                        if (Array.isArray(msg.buses)) {
                            animator.upsertBuses(msg.buses, true, now);
                        }
                        if (Array.isArray(msg.trains)) {
                            animator.upsertTrains(msg.trains, now);
                        }
                    } else if (msg.type === 'bus_delta') {
                        metrics.busDeltas += 1;
                        if (Array.isArray(msg.features)) {
                            animator.upsertBuses(msg.features, false, now);
                        }
                    } else if (msg.type === 'train_tick') {
                        metrics.trainTicks += 1;
                        if (Array.isArray(msg.trains)) {
                            animator.upsertTrains(msg.trains, now);
                        }
                    }
                } catch {}
            };

            ws.onerror = () => {
                ws?.close();
            };

            ws.onclose = () => {
                metrics.connected = false;
                if (pingTimer) {
                    clearInterval(pingTimer);
                    pingTimer = null;
                }
                if (!isMounted) return;
                // Keep vehicles updating via fallback poll while WebSocket reconnects
                if (!fallbackPollTimer) {
                    fetchRestFallback();
                    fallbackPollTimer = setInterval(fetchRestFallback, 4000);
                }
                scheduleReconnect();
            };
        };

        const scheduleReconnect = () => {
            if (!isMounted) return;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                reconnectDelayMs = Math.min(5000, reconnectDelayMs * 1.5);
                connectWebSocket();
            }, reconnectDelayMs);
        };

        connectWebSocket();

        return () => {
            isMounted = false;
            if (rafId !== null) cancelAnimationFrame(rafId);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (pingTimer) clearInterval(pingTimer);
            if (fallbackPollTimer) clearInterval(fallbackPollTimer);
            if (ws) {
                ws.onclose = null;
                ws.onerror = null;
                ws.onmessage = null;
                ws.close();
            }
        };
    }, [isMapLoaded]);

    // Toggle corridor background layer visibility
    const handleToggleCorridors = () => {
        const map = mapRef.current;
        if (!map) return;
        const nextState = !corridorsVisible;
        setCorridorsVisible(nextState);
        const layersToToggle = [
            'all-corridors-layer',
            'railway-track-casing',
            'railway-track-ties',
            'all-shelters-icon',
            'all-shelters-label',
            'live-trains-icon',
            'live-trains-label',
        ];
        for (const lid of layersToToggle) {
            if (map.getLayer(lid)) {
                map.setLayoutProperty(lid, 'visibility', nextState ? 'visible' : 'none');
            }
        }
    };

    // Re-center on Bandung City Center
    const handleRecenterBandung = () => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
            center: [107.6191, -6.9175],
            zoom: 12.8,
            duration: 1000,
        });
    };

    return (
        <div className="relative w-full h-full overflow-hidden">
            {/* Map Canvas */}
            <div ref={containerRef} className="w-full h-full" />

            {/* Floating Map Utility Buttons (Right Side) */}
            <div className="absolute right-3.5 bottom-40 md:bottom-8 flex flex-col gap-2 z-20">
                {/* Reset Camera to Fit Trip */}
                {(origin || destination || trip) && (
                    <button
                        type="button"
                        onClick={fitCameraToTrip}
                        title="Fit Route to View"
                        className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-50 active:scale-95 transition-all"
                    >
                        <Maximize2 className="w-4 h-4" />
                    </button>
                )}

                {/* Re-center Bandung */}
                <button
                    type="button"
                    onClick={handleRecenterBandung}
                    title="Center Bandung"
                    className="w-10 h-10 rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-50 active:scale-95 transition-all"
                >
                    <Crosshair className="w-4 h-4" />
                </button>

                {/* Toggle All Transit Corridors & Railway Lines */}
                <button
                    type="button"
                    onClick={handleToggleCorridors}
                    title={corridorsVisible ? 'Hide all network corridors & railway' : 'Show all network corridors & railway'}
                    className={`w-10 h-10 rounded-full shadow-lg border transition-all flex items-center justify-center active:scale-95 ${
                        corridorsVisible
                            ? 'bg-blue-600 text-white border-blue-700'
                            : 'bg-white/95 backdrop-blur-md text-slate-600 border-slate-200'
                    }`}
                >
                    <Layers className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
