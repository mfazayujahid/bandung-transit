/**
 * Centralized API & WebSocket base URL configuration.
 *
 * By default (when VITE_API_BASE is unset), uses same-origin relative paths so
 * Vite's `/api` proxy (HTTP + WebSocket) works transparently across:
 *   - http://localhost:5173
 *   - Local Network (LAN) IPs, e.g. http://192.167.4.140:5173
 *   - HTTPS tunnels / reverse proxies
 * with zero CORS or multi-port firewall friction.
 */
const rawApiBase = (import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');

export const API_BASE: string = rawApiBase;

export function getWsBase(): string {
    if (rawApiBase) {
        return rawApiBase.replace(/^http/i, 'ws');
    }
    if (typeof window !== 'undefined') {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProto}//${window.location.host}`;
    }
    return 'ws://127.0.0.1:8000';
}

export const WS_BASE: string = getWsBase();
