// 클린오피스 PC 서버
// 1) PC 브라우저에 클린오피스 화면을 띄우고 (http://localhost:5192)
// 2) 같은 와이파이의 휴대폰이 'PC 공유 폴더'를 열고 저장할 수 있게 한다.
//    휴대폰은 QR 코드에 들어 있는 비밀 코드가 있어야만 접근할 수 있다.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.CO_DIST || path.join(HERE, '..', 'dist'));
const PORT = Number(process.env.CO_PORT || 5192);
const MAX_UPLOAD = 60 * 1024 * 1024;
const CONFIG_DIR = process.env.CO_CONFIG_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'CleanOffice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'server.json');

// ---------- 설정 (공유 폴더, 연결 코드) ----------
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* 처음 실행 */ }
  cfg.folder = process.env.CO_FOLDER || cfg.folder || path.join(os.homedir(), 'Documents', '클린오피스');
  cfg.key ||= crypto.randomBytes(18).toString('base64url');
  return cfg;
}
function saveConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
const config = loadConfig();
fs.mkdirSync(config.folder, { recursive: true });
saveConfig();
const ROOT = () => path.resolve(config.folder);

// ---------- 도우미 ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // 연결 안 된 어댑터
      out.push({ name, url: `http://${a.address}:${PORT}` });
    }
  }
  // 집 와이파이(192.168.x)를 먼저
  return out.sort((a, b) => (b.url.includes('//192.168.') - a.url.includes('//192.168.')));
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function safePath(rel = '') {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || p.startsWith('.') || /[:*?"<>|]/.test(p))) return null;
  const full = path.resolve(ROOT(), ...parts);
  const root = ROOT();
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    ...cors(),
    ...headers,
  });
  res.end(isBuf ? body : JSON.stringify(body));
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-CO-Key, Content-Type, X-CO-Base',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Expose-Headers': 'X-CO-Mtime',
    'Access-Control-Allow-Private-Network': 'true',
  };
}

// 틀린 코드를 계속 넣으면 잠시 막음
const failures = new Map();
function authorized(req) {
  const ip = req.socket.remoteAddress;
  const f = failures.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return 'locked';
  const given = Buffer.from(String(req.headers['x-co-key'] || ''));
  const want = Buffer.from(config.key);
  const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (ok) { failures.delete(ip); return true; }
  f.n += 1;
  if (f.n >= 10) { f.until = Date.now() + 60_000; f.n = 0; }
  failures.set(ip, f);
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_UPLOAD) { reject(Object.assign(new Error('파일이 너무 큽니다 (60MB 초과)'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname;

  // PC 화면 전용 (이 PC에서만): QR에 넣을 정보
  if (p === '/api/local/pair' || p === '/api/local/rotate') {
    if (!isLoopback(req)) return send(res, 403, { error: '이 PC에서만 볼 수 있습니다' });
    if (p === '/api/local/rotate') {
      if (req.method !== 'PUT') return send(res, 405, { error: 'PUT만 됩니다' });
      config.key = crypto.randomBytes(18).toString('base64url');
      saveConfig();
    }
    return send(res, 200, { key: config.key, addresses: lanAddresses(), folder: ROOT(), name: os.hostname(), port: PORT });
  }

  const auth = authorized(req);
  if (auth === 'locked') return send(res, 429, { error: '연결 코드를 여러 번 틀려 1분 동안 막혔습니다. 잠시 뒤 다시 시도하세요.' });
  if (!auth) return send(res, 401, { error: '연결 코드가 맞지 않습니다. PC 화면의 QR을 다시 찍어 주세요.' });

  if (p === '/api/info') return send(res, 200, { name: os.hostname(), folder: path.basename(ROOT()) });

  if (p === '/api/list' && req.method === 'GET') {
    const dir = safePath(url.searchParams.get('path') || '');
    if (!dir) return send(res, 400, { error: '잘못된 경로' });
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return send(res, 404, { error: '폴더가 없습니다' });
    const items = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue; // 숨김·오피스 임시 파일
      if (!e.isFile() && !e.isDirectory()) continue;
      const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
      if (!st) continue;
      items.push({ name: e.name, dir: e.isDirectory(), size: st.size, mtime: st.mtimeMs });
    }
    items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'ko'));
    return send(res, 200, { items });
  }

  if (p === '/api/file') {
    const file = safePath(url.searchParams.get('path') || '');
    if (!file || file === ROOT()) return send(res, 400, { error: '잘못된 경로' });

    if (req.method === 'GET') {
      const st = await fsp.stat(file).catch(() => null);
      if (!st?.isFile()) return send(res, 404, { error: '파일이 없습니다' });
      if (st.size > MAX_UPLOAD) return send(res, 413, { error: '파일이 너무 큽니다 (60MB 초과)' });
      return send(res, 200, await fsp.readFile(file), { 'X-CO-Mtime': String(st.mtimeMs) });
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const st = await fsp.stat(file).catch(() => null);
      if (st?.isDirectory()) return send(res, 400, { error: '같은 이름의 폴더가 있습니다' });
      const base = req.headers['x-co-base'];
      // 폰에서 연 뒤 PC에서 파일이 바뀌었으면 덮어쓰지 않고 알려줌
      if (st && base && base !== 'force' && Math.abs(Number(base) - st.mtimeMs) > 1) {
        return send(res, 409, { error: 'PC에서 파일이 바뀌었습니다', mtime: st.mtimeMs });
      }
      if (st && base === undefined) return send(res, 409, { error: '같은 이름의 파일이 이미 있습니다', exists: true });
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.co-${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, body);
      await fsp.rename(tmp, file);
      const now = await fsp.stat(file);
      return send(res, 200, { mtime: now.mtimeMs, size: now.size });
    }
  }

  return send(res, 404, { error: '없는 기능' });
}

// ---------- 화면 파일 ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

async function staticFile(req, res, url) {
  // 화면은 이 PC에서만 띄움 (폰은 앱으로 접속)
  if (!isLoopback(req)) return send(res, 403, { error: '폰에서는 클린오피스 앱으로 연결하세요' });
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(DIST, `.${rel}`);
  if (!full.startsWith(DIST + path.sep)) return send(res, 400, { error: '잘못된 경로' });
  const st = await fsp.stat(full).catch(() => null);
  const target = st?.isFile() ? full : path.join(DIST, 'index.html');
  const ext = path.extname(target);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET') return send(res, 405, { error: '지원하지 않는 요청' });
    return await staticFile(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '서버 오류' });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`클린오피스가 이미 켜져 있습니다 → http://localhost:${PORT}`);
    if (!process.env.CO_NO_OPEN) exec(`start "" "http://localhost:${PORT}"`);
    setTimeout(() => process.exit(0), 1500);
  } else {
    console.error(e);
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('클린오피스 PC 서버가 켜졌습니다.');
  console.log(`  화면: http://localhost:${PORT}`);
  console.log(`  공유 폴더: ${ROOT()}`);
  for (const a of lanAddresses()) console.log(`  폰 연결 주소(${a.name}): ${a.url}`);
  console.log('이 창을 닫으면 서버도 꺼집니다.');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) console.log('※ dist 폴더가 없습니다. npm run build 를 먼저 실행하세요.');
  if (!process.env.CO_NO_OPEN) exec(`start "" "http://localhost:${PORT}"`);
});
