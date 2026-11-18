#!/usr/bin/env node
/**
 * Bandung Transit Monorepo Runner
 * Starts both FastAPI backend (:8000) and Vite frontend (:5173) in one command
 * with prefixed logs and clean process-tree shutdown on Ctrl+C.
 *
 * Usage:
 *   node scripts/dev.mjs          # Backend + Frontend (HTTP, LAN enabled)
 *   node scripts/dev.mjs --https  # Backend + Frontend (HTTPS, LAN + Mobile GPS enabled)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const UI_DIR = path.join(ROOT_DIR, 'bandung-transit-ui');

const isHttps = process.argv.includes('--https');
const isWin = process.platform === 'win32';

const COLORS = {
    reset: '\x1b[0m',
    api: '\x1b[36m', // cyan
    ui: '\x1b[32m',  // green
    sys: '\x1b[33m', // yellow
};

const children = [];
let shuttingDown = false;

function prefixStream(stream, tag, color, target) {
    let buffer = '';
    stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            target.write(`${color}[${tag}]${COLORS.reset} ${line}\n`);
        }
    });
    stream.on('end', () => {
        if (buffer.length > 0) {
            target.write(`${color}[${tag}]${COLORS.reset} ${buffer}\n`);
        }
    });
}

function startService({ tag, color, command, args, cwd }) {
    const resolvedCmd = isWin && command === 'npm' ? 'cmd.exe' : command;
    const resolvedArgs = isWin && command === 'npm' ? ['/d', '/s', '/c', command, ...args] : args;

    const child = spawn(resolvedCmd, resolvedArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, FORCE_COLOR: '1' },
    });

    prefixStream(child.stdout, tag, color, process.stdout);
    prefixStream(child.stderr, tag, color, process.stderr);

    child.on('exit', (code, signal) => {
        if (!shuttingDown) {
            console.log(
                `${COLORS.sys}[SYS]${COLORS.reset} ${tag} exited (code=${code ?? 'null'}, signal=${signal ?? 'none'}). Stopping all services...`
            );
            shutdown(code || 0);
        }
    });

    child.on('error', (err) => {
        console.error(`${COLORS.sys}[SYS]${COLORS.reset} Failed to start ${tag}:`, err.message);
        shutdown(1);
    });

    children.push(child);
    return child;
}

function killTree(child) {
    if (!child || child.killed || !child.pid) return;
    if (isWin) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            shell: false,
        });
    } else {
        try {
            child.kill('SIGTERM');
        } catch {}
    }
}

function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
        killTree(child);
    }
    setTimeout(() => process.exit(exitCode), 300);
}

process.on('SIGINT', () => {
    console.log(`\n${COLORS.sys}[SYS]${COLORS.reset} Shutting down Bandung Transit (API + UI)...`);
    shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

console.log(
    `${COLORS.sys}[SYS]${COLORS.reset} Starting Bandung Transit monorepo (${isHttps ? 'HTTPS + LAN GPS mode' : 'HTTP + LAN mode'})...`
);

// 1. Backend API (FastAPI + PostGIS + WebSocket telemetry via uv)
startService({
    tag: 'API',
    color: COLORS.api,
    command: 'uv',
    args: [
        '--directory',
        'bandung-transit-api',
        'run',
        'python',
        '-m',
        'uvicorn',
        'app.main:app',
        '--reload',
        '--port',
        '8000',
    ],
    cwd: ROOT_DIR,
});

// 2. Frontend UI (Vite + React + MapLibre GL with /api proxy & LAN host binding)
startService({
    tag: 'UI ',
    color: COLORS.ui,
    command: 'npm',
    args: ['run', isHttps ? 'dev:https' : 'dev'],
    cwd: UI_DIR,
});
