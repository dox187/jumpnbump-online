import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { Lobby } from './lobby';
import { social_meta } from './social';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = path.resolve(
    process.env.STATIC_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
);
/** Set when running behind a reverse proxy, so rate limits see the real client address. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const HEARTBEAT_MS = 30000;

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.dat': 'application/octet-stream',
};

async function find_file(url_path: string): Promise<string | null> {
    let decoded: string;
    try {
        decoded = decodeURIComponent(url_path);
    } catch {
        return null;
    }
    if (decoded.includes('\0')) return null;
    const candidate = path.join(STATIC_DIR, path.normalize(decoded));
    if (candidate !== STATIC_DIR && !candidate.startsWith(STATIC_DIR + path.sep)) return null;

    for (const file of [candidate, path.join(candidate, 'index.html')]) {
        try {
            if ((await stat(file)).isFile()) return file;
        } catch {
            // try the next candidate
        }
    }
    return null;
}

function cache_control(file: string) {
    const relative = path.relative(STATIC_DIR, file);
    if (relative.startsWith('assets' + path.sep)) return 'public, max-age=31536000, immutable';
    if (file.endsWith('.html')) return 'no-cache';
    return 'public, max-age=86400';
}

async function serve_static(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    const url_path = new URL(request.url ?? '/', 'http://localhost').pathname;
    let file = await find_file(url_path);
    let status = 200;
    if (!file) {
        // Unknown routes get the app shell so the client-side router can show its 404 page
        if (path.extname(url_path)) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
            return;
        }
        file = path.join(STATIC_DIR, 'index.html');
        status = 404;
    }

    const info = await stat(file);
    const html = file.endsWith('.html') ? social_meta(await readFile(file, 'utf8'), request, TRUST_PROXY) : null;
    response.writeHead(status, {
        'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': html === null ? info.size : Buffer.byteLength(html),
        'Cache-Control': cache_control(file),
        'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
        response.end();
        return;
    }
    if (html !== null) {
        response.end(html);
        return;
    }
    createReadStream(file).pipe(response);
}

function client_ip(request: IncomingMessage) {
    if (TRUST_PROXY) {
        const forwarded = request.headers['x-forwarded-for'];
        const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
        if (first) return first;
    }
    return request.socket.remoteAddress ?? 'unknown';
}

const LEVELS_DIR = path.resolve(process.env.LEVELS_DIR ?? path.join(STATIC_DIR, 'levels'));
const lobby = new Lobby(LEVELS_DIR);

const server = createServer((request, response) => {
    serve_static(request, response).catch((error) => {
        console.error('static file error', error);
        if (!response.headersSent) response.writeHead(500);
        response.end();
    });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
const alive = new WeakMap<WebSocket, boolean>();

server.on('upgrade', (request, socket, head) => {
    const url_path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (url_path !== '/ws') {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
        alive.set(ws, true);
        ws.on('pong', () => alive.set(ws, true));
        ws.on('error', () => ws.terminate());
        lobby.connect(ws, client_ip(request));
    });
});

setInterval(() => {
    for (const ws of wss.clients) {
        if (!alive.get(ws)) {
            ws.terminate();
            continue;
        }
        alive.set(ws, false);
        ws.ping();
    }
}, HEARTBEAT_MS).unref();

server.listen(PORT, HOST, () => {
    console.log(`Jump 'n Bump server listening on http://${HOST}:${PORT} (static files from ${STATIC_DIR})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        console.log(`${signal} received, shutting down`);
        for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
    });
}
