import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChangelogStore } from './ChangelogStore.js';
import { GameStore } from './GameStore.js';

const port = Number(process.env.PORT || 3000);
const clientDirectory = resolve(fileURLToPath(new URL('../client/', import.meta.url)));
const dataDirectory = process.env.DATA_DIR || '/data';
const gameStore = new GameStore(resolve(dataDirectory, 'game-data.json'));
const changelog = new ChangelogStore(new URL('../client/changelog.json', import.meta.url));
const limits = new Map<string, { count: number; resetsAt: number }>();
const lastUpdateValue = resolveLastUpdate();

await Promise.all([gameStore.load(), changelog.load()]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/api/status') {
      return json(response, { ...gameStore.status(), lastUpdate: lastUpdateValue });
    }
    if (request.method === 'POST' && url.pathname === '/api/plays') {
      if (!allow(request, 'plays', 30)) return json(response, { error: 'Too many requests' }, 429);
      return json(response, { playCount: gameStore.recordPlay(), lastUpdate: lastUpdateValue });
    }
    if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
      return json(response, { entries: gameStore.entries() });
    }
    if (request.method === 'POST' && url.pathname === '/api/leaderboard') {
      const body = await readJson(request);
      const entry = await gameStore.submit(body.name, body.score, body.survivalMs, body.submissionId);
      return entry ? json(response, { ok: true, entry }) : json(response, { error: 'Invalid score' }, 400);
    }
    if (request.method === 'GET' && url.pathname === '/api/changelog') {
      return json(response, changelog.current());
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, { error: 'Not found' }, 404);
    return await serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, { error: 'Internal server error' }, 500);
    else response.destroy();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`The Last Light listening on 0.0.0.0:${port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await gameStore.flush();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return json(response, { error: 'Bad request' }, 400);
  }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  let filePath = resolve(clientDirectory, relativePath);
  if (filePath !== clientDirectory && !filePath.startsWith(`${clientDirectory}${sep}`)) {
    return json(response, { error: 'Not found' }, 404);
  }
  try {
    let fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
      fileStat = await stat(filePath);
    }
    if (!fileStat.isFile()) throw new Error('Not a file');
  } catch {
    if (!extname(relativePath)) filePath = resolve(clientDirectory, 'index.html');
    else return json(response, { error: 'Not found' }, 404);
  }
  response.statusCode = 200;
  response.setHeader('content-type', mimeType(filePath));
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('cache-control', filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) throw new Error('Request body too large');
  }
  const parsed = JSON.parse(body || '{}');
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
}

function allow(request: IncomingMessage, action: string, maximum: number): boolean {
  const forwarded = request.headers['cf-connecting-ip'] || request.headers['x-forwarded-for'];
  const address = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? request.socket.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();
  const key = `${address}:${action}`;
  const now = Date.now();
  const current = limits.get(key);
  if (!current || now >= current.resetsAt) {
    limits.set(key, { count: 1, resetsAt: now + 60000 });
    return true;
  }
  current.count += 1;
  return current.count <= maximum;
}

function resolveLastUpdate(): string {
  const value = process.env.LAST_UPDATE || process.env.BUILD_DATE || process.env.SOURCE_DATE_EPOCH;
  if (value) {
    const parsed = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const buildTimestamp = Number(process.env.BUILD_TIMESTAMP);
  return new Date(Number.isFinite(buildTimestamp) && buildTimestamp > 0 ? buildTimestamp : Date.now()).toISOString();
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(value));
}

function mimeType(path: string): string {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  } as Record<string, string>)[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
