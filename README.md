# Bandung Transit

Multi-modal public transit navigation for Greater Bandung (Trans Metro Pasundan / MJT BRT, feeder corridors, and Commuter Line Bandung Raya) with real-time WebSocket vehicle tracking and live GPS turn-by-turn guidance.

## Monorepo Structure

```text
bandung-transit/
├── bandung-transit-api/   # Backend: FastAPI, PostGIS, NetworkX, Live Telemetry
├── bandung-transit-ui/    # Frontend: React 19, TypeScript, Vite, MapLibre GL
├── scripts/dev.mjs        # Single-command runner for both API and UI
└── package.json           # Root monorepo scripts
```

## Prerequisites

- **Node.js** 20+
- **Python** 3.12+ with [`uv`](https://docs.astral.sh/uv/)
- **PostgreSQL** with **PostGIS** extension

## Quick Start

1. **Configure environment variables**:
   ```bash
   cp bandung-transit-api/.env.example bandung-transit-api/.env
   # Edit bandung-transit-api/.env with your PostgreSQL/PostGIS DATABASE_URL
   ```

2. **Install dependencies (Backend + Frontend)**:
   ```bash
   npm run setup
   ```

3. **Run both Frontend and Backend in one command**:
   - **Standard (HTTP + LAN)**:
     ```bash
     npm run dev
     ```
     Open `http://localhost:5173` (or `http://<your-lan-ip>:5173` on local network).

   - **Mobile GPS over LAN (HTTPS)**:
     ```bash
     npm run dev:https
     ```
     Open `https://localhost:5173` (or `https://<your-lan-ip>:5173` on your phone and accept the one-time local dev certificate prompt).

## Useful Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start FastAPI (`:8000`) and Vite (`:5173`, HTTP) together |
| `npm run dev:https` | Start FastAPI (`:8000`) and Vite (`:5173`, HTTPS for mobile GPS on LAN) together |
| `npm run dev:api` | Start backend only |
| `npm run dev:ui` | Start frontend only |
| `npm run build` | Type-check and build frontend production bundle |
| `npm run setup` | Install Python (`uv sync`) and Node (`npm install`) dependencies |
