import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const backendTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const enableHttps = mode === 'https' || process.env.VITE_HTTPS === 'true';

    return {
        plugins: [
            react(),
            tailwindcss(),
            ...(enableHttps ? [basicSsl()] : []),
        ],
        server: {
            host: true, // Bind to 0.0.0.0 so devices on the local network (LAN) can access the app
            port: 5173,
            proxy: {
                '/api': {
                    target: backendTarget,
                    changeOrigin: true,
                    ws: true, // Proxy WebSocket connections (/api/transit/ws/live) seamlessly over HTTP & HTTPS
                },
            },
        },
        preview: {
            host: true,
            port: 4173,
            proxy: {
                '/api': {
                    target: backendTarget,
                    changeOrigin: true,
                    ws: true,
                },
            },
        },
    };
});
