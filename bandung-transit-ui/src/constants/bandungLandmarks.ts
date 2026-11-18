import type { LocationPoint } from '../types/transit';

export const BANDUNG_LANDMARKS: LocationPoint[] = [
    {
        name: 'Stasiun Bandung',
        description: 'Pusat Kota, Halte K2D & Commuter Line',
        coords: [107.601705, -6.914280],
        isPreset: true,
    },
    {
        name: 'Stasiun Cimahi',
        description: 'Hub Cimahi & Commuter Line',
        coords: [107.535882, -6.885540],
        isPreset: true,
    },
    {
        name: 'Stasiun Padalarang',
        description: 'Hub Kereta Cepat Whoosh & Commuter Line',
        coords: [107.496856, -6.842418],
        isPreset: true,
    },
    {
        name: 'Stasiun Kiaracondong',
        description: 'Hub Kiaracondong & Commuter Line',
        coords: [107.645249, -6.924585],
        isPreset: true,
    },
    {
        name: 'Stasiun Rancaekek',
        description: 'Hub Rancaekek & Commuter Line',
        coords: [107.755848, -6.964820],
        isPreset: true,
    },
    {
        name: 'Stasiun Cicalengka',
        description: 'Terminus Timur Commuter Line',
        coords: [107.833287, -6.982192],
        isPreset: true,
    },
    {
        name: 'Alun-alun Bandung',
        description: 'Jl. Asia Afrika, Hub K2D & Trans Metro',
        coords: [107.6098, -6.9218],
        isPreset: true,
    },
    {
        name: 'Simpang Dago',
        description: 'Jl. Ir. H. Juanda, Hub K4D Dago',
        coords: [107.6163, -6.8856],
        isPreset: true,
    },
    {
        name: 'Dipatiukur',
        description: 'Monumen Perjuangan, Hub K5D Jatinangor',
        coords: [107.6185, -6.8927],
        isPreset: true,
    },
    {
        name: 'BEC (Bandung Elec. Ctr)',
        description: 'Jl. Purnawarman, Hub K3D Baleendah',
        coords: [107.6074, -6.9068],
        isPreset: true,
    },
    {
        name: 'Terminal Leuwipanjang',
        description: 'Hub K1D Soreang & K4D Dago',
        coords: [107.5946, -6.9472],
        isPreset: true,
    },
    {
        name: 'ITB Ganesha',
        description: 'Jl. Ganesha, Koridor K4D',
        coords: [107.6106, -6.8915],
        isPreset: true,
    },
    {
        name: 'Jatinangor (Unpad)',
        description: 'Kampus Jatinangor, Hub K5D Tol',
        coords: [107.7738, -6.9272],
        isPreset: true,
    },
];

export const CORRIDOR_BRAND_COLORS: Record<string, { name: string; color: string; badgeText: string }> = {
    CLR: { name: 'Commuter Line Bandung Raya', color: '#1e3a8a', badgeText: 'CLR' },
    K1D: { name: 'Leuwipanjang - Soreang', color: '#0284c7', badgeText: 'K1D' },
    K2D: { name: 'Kota Baru Parahyangan - Alun-alun', color: '#e11d48', badgeText: 'K2D' },
    K3D: { name: 'Baleendah - BEC', color: '#059669', badgeText: 'K3D' },
    K4D: { name: 'Leuwipanjang - Dago', color: '#7c3aed', badgeText: 'K4D' },
    K5D: { name: 'Dipatiukur - Jatinangor (Tol)', color: '#d97706', badgeText: 'K5D' },
};
