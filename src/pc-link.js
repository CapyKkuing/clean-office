// 같은 와이파이의 PC와 파일 주고받기
// - PC: 'PC 연결' 화면에 QR 코드 표시 (클린오피스 실행.bat 으로 켠 경우)
// - 폰: QR을 찍어 PC의 '클린오피스' 폴더를 열고 저장
import { h, toast, busy, extOf } from './ui.js';
import { isNative } from './files.js';

const STORE_KEY = 'co-pc-link';
const OPENABLE = new Set(['pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'csv', 'ods', 'pptx', 'hwp', 'hwpx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

// ---------- 연결 정보 ----------
export function getLink() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function setLink(link) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(link)); } catch { /* 저장 불가 */ }
}
function clearLink() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* 저장 불가 */ }
}

// QR 내용: cleanoffice://pc?k=코드&n=PC이름&u=http://192.168.0.5:5192&u=...
export function parsePairText(text) {
  try {
    const u = new URL(text.trim());
    if (u.protocol !== 'cleanoffice:') return null;
    const key = u.searchParams.get('k');
    const urls = u.searchParams.getAll('u').filter((x) => /^http:\/\/[\w.:-]+$/.test(x));
    if (!key || !urls.length) return null;
    return { key, urls, name: u.searchParams.get('n') || 'PC' };
  } catch {
    return null;
  }
}

class LinkError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// 저장된 주소들을 차례로 시도 (PC 주소가 바뀌었을 수 있음)
async function call(link, path, opts = {}, ms = 15000) {
  const urls = [link.active, ...link.urls.filter((x) => x !== link.active)].filter(Boolean);
  let lastErr;
  for (const base of urls) {
    let res;
    try {
      res = await fetchWithTimeout(`${base}${path}`, { ...opts, headers: { ...(opts.headers || {}), 'X-CO-Key': link.key } }, base === link.active ? ms : Math.min(ms, 5000));
    } catch (e) {
      lastErr = e;
      continue; // 다음 주소
    }
    if (link.active !== base) { link.active = base; setLink(link); }
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch { /* 본문 없음 */ }
      throw new LinkError(body.error || `PC 오류 ${res.status}`, res.status, body);
    }
    return res;
  }
  throw new LinkError('PC에 연결할 수 없습니다. PC에서 클린오피스가 켜져 있고, 폰과 같은 와이파이인지 확인하세요.', 0, { cause: String(lastErr) });
}

const enc = (p) => encodeURIComponent(p);

export async function getPcFile(link, rel) {
  const res = await call(link, `/api/file?path=${enc(rel)}`);
  return { data: await res.arrayBuffer(), mtime: Number(res.headers.get('X-CO-Mtime')) || 0 };
}

// base: 열 때의 수정 시각(덮어쓰기 확인용), 'force', 또는 undefined(새 파일)
export async function putPcFile(link, rel, blob, base) {
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (base !== undefined) headers['X-CO-Base'] = String(base);
  const res = await call(link, `/api/file?path=${enc(rel)}`, { method: 'PUT', headers, body: blob }, 60000);
  return res.json();
}

// 폰 → PC 저장 (충돌하면 물어봄). 성공하면 { path, mtime }, 취소면 null
export async function savePc(link, rel, blob, base) {
  try {
    const r = await putPcFile(link, rel, blob, base);
    return { path: rel, mtime: r.mtime };
  } catch (e) {
    if (e.status !== 409) throw e;
    const msg = e.body?.exists
      ? `PC 폴더에 '${rel}' 파일이 이미 있습니다. 덮어쓸까요?`
      : '이 파일이 폰에서 연 뒤에 PC에서 바뀌었습니다.\n지금 내용으로 덮어쓸까요? (취소하면 저장하지 않음)';
    if (!confirm(msg)) return null;
    const r = await putPcFile(link, rel, blob, 'force');
    return { path: rel, mtime: r.mtime };
  }
}

// ---------- 폰 화면 ----------
async function scanQr() {
  const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    toast('QR 스캐너를 준비하는 중입니다. 몇 초 뒤 다시 눌러 주세요.', 4000);
    return null;
  }
  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
  return barcodes[0]?.rawValue || null;
}

async function connectWith(link) {
  busy(true, 'PC에 연결 중…');
  try {
    const res = await call(link, '/api/info', {}, 6000);
    const info = await res.json();
    link.name = info.name || link.name;
    setLink(link);
    toast(`${link.name} 에 연결했습니다`);
    return true;
  } catch (e) {
    toast(e.message, 5000);
    return false;
  } finally {
    busy(false);
  }
}

export function renderPcBrowser(stage, onOpen) {
  const root = h('div', { class: 'drive' });
  stage.append(root);
  let path = [];

  function showConnect() {
    const manual = async () => {
      const addr = prompt('PC 화면에 나온 주소를 입력하세요 (예: 192.168.0.5:5192)');
      if (!addr) return;
      const key = prompt('PC 화면에 나온 연결 코드를 입력하세요');
      if (!key) return;
      const url = `http://${addr.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
      if (!/^http:\/\/[\w.-]+(:\d+)?$/.test(url)) return toast('주소 형식이 맞지 않습니다');
      const link = { key: key.trim(), urls: [url.includes(':', 5) ? url : `${url}:5192`], name: 'PC' };
      if (await connectWith(link)) showBrowser();
    };
    const scan = async () => {
      try {
        const text = await scanQr();
        if (!text) return;
        const link = parsePairText(text);
        if (!link) return toast('클린오피스 PC 연결용 QR이 아닙니다', 4000);
        if (await connectWith(link)) showBrowser();
      } catch (e) {
        // 뒤로가기로 닫으면 'Failed to scan code' 가 오므로 조용히 넘김
        if (!/cancel|failed to scan/i.test(String(e?.message))) toast(`QR을 읽지 못했습니다: ${e.message}`, 4000);
      }
    };
    root.replaceChildren(h('div', { class: 'notice drive-login' },
      h('b', {}, 'PC와 연결하기'),
      h('p', {}, '1) PC에서 "클린오피스 실행"을 켜고 "폰 연결"을 누르면 QR 코드가 나옵니다.'),
      h('p', {}, '2) 폰과 PC가 같은 와이파이에 있어야 합니다.'),
      h('p', {}, '3) 아래 버튼으로 QR을 찍으면, PC의 "클린오피스" 폴더 파일을 열고 저장할 수 있습니다.'),
      h('p', { class: 'warn-line' }, '⚠ 집·사무실처럼 믿을 수 있는 와이파이에서만 쓰세요. 카페 등 공용 와이파이에서는 다른 사람이 오가는 파일을 엿볼 수 있습니다.'),
      isNative ? h('button', { class: 'btn primary', onclick: scan }, 'QR 코드 찍기') : null,
      h('button', { class: 'btn', onclick: manual }, '주소·코드 직접 입력')));
  }

  const crumbs = h('div', { class: 'crumbs' });
  const list = h('ul', { class: 'recent-list drive-list' });
  const status = h('p', { class: 'empty' });

  function renderCrumbs(link) {
    const parts = [{ name: `💻 ${link.name}`, depth: 0 }, ...path.map((p, i) => ({ name: p, depth: i + 1 }))];
    crumbs.replaceChildren(...parts.flatMap((p, i) => [
      i ? h('span', { class: 'sep-ch' }, '›') : null,
      h('button', { onclick: () => { path = path.slice(0, p.depth); load(); } }, p.name),
    ]));
  }

  async function load() {
    const link = getLink();
    if (!link) return showConnect();
    renderCrumbs(link);
    list.replaceChildren();
    status.hidden = false;
    status.textContent = '불러오는 중…';
    try {
      const res = await call(link, `/api/list?path=${enc(path.join('/'))}`);
      const { items } = await res.json();
      status.hidden = items.length > 0;
      status.textContent = '이 폴더는 비어 있습니다. PC의 문서\\클린오피스 폴더에 파일을 넣으면 여기 보입니다.';
      list.replaceChildren(...items.map((it) => {
        const ext = extOf(it.name);
        const ok = it.dir || OPENABLE.has(ext);
        const known = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'pptx', 'hwp'];
        const cls = it.dir ? 'b-folder' : known.includes(ext) ? `b-${ext}` : ext === 'hwpx' ? 'b-hwp' : 'b-other';
        return h('li', { class: ok ? '' : 'dim', onclick: () => ok && open(it) },
          h('span', { class: `badge ${cls}` }, it.dir ? '📁' : (ext || '?').toUpperCase().slice(0, 4)),
          h('div', { class: 'meta' },
            h('div', { class: 'name' }, it.name),
            h('div', { class: 'sub' }, `${new Date(it.mtime).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}${it.dir ? '' : ` · ${Math.max(1, Math.round(it.size / 1024))} KB`}${ok ? '' : ' · 열 수 없는 형식'}`)));
      }));
    } catch (e) {
      status.textContent = e.message;
      if (e.status === 401) { clearLink(); showConnect(); toast(e.message, 5000); }
    }
  }

  async function open(it) {
    if (it.dir) { path.push(it.name); load(); return; }
    const link = getLink();
    const rel = [...path, it.name].join('/');
    busy(true, 'PC에서 받는 중…');
    try {
      const got = await getPcFile(link, rel);
      busy(false);
      onOpen(it.name, got.data, { name: it.name, pc: { path: rel, mtime: got.mtime } });
    } catch (e) {
      busy(false);
      toast(`열지 못했습니다: ${e.message}`, 4500);
    }
  }

  function showBrowser() {
    const link = getLink();
    root.replaceChildren(
      h('div', { class: 'drive-head' },
        h('div', { class: 'drive-tabs' },
          h('button', { class: 'on', onclick: () => { path = []; load(); } }, 'PC 폴더'),
          h('button', { onclick: () => load() }, '새로고침'),
          h('button', { class: 'link-btn', onclick: () => { if (confirm(`${link.name} 연결을 끊을까요?`)) { clearLink(); showConnect(); } } }, '연결 끊기')),
        crumbs),
      list, status);
    load();
  }

  if (getLink()) showBrowser(); else showConnect();
}

// ---------- PC 화면: QR 보여주기 ----------
export async function renderPcPanel(stage) {
  const root = h('div', { class: 'drive pc-panel' });
  stage.append(root);
  let info;
  try {
    const res = await fetch('/api/local/pair');
    if (!res.ok) throw new Error();
    info = await res.json();
  } catch {
    root.append(h('div', { class: 'notice', html:
      '<b>폰 연결은 "클린오피스 실행" 프로그램으로 켰을 때만 됩니다.</b><br>프로젝트 폴더의 <b>클린오피스 실행.bat</b>을 더블클릭해서 켜 주세요.' }));
    return;
  }
  const QR = await import('qrcode');
  const draw = async () => {
    const params = new URLSearchParams({ k: info.key, n: info.name });
    info.addresses.forEach((a) => params.append('u', a.url));
    const text = `cleanoffice://pc?${params}`;
    const img = await QR.toDataURL(text, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
    const addrs = info.addresses.map((a) => a.url.replace('http://', ''));
    root.replaceChildren(h('div', { class: 'notice pc-card' },
      h('b', {}, '휴대폰으로 이 QR을 찍으세요'),
      h('p', {}, '폰의 클린오피스 앱 → 홈의 "PC 연결" → "QR 코드 찍기"'),
      addrs.length ? h('img', { src: img, alt: '연결용 QR 코드', class: 'qr' }) : h('p', { class: 'warn' }, '와이파이(네트워크)에 연결돼 있지 않습니다.'),
      h('div', { class: 'kv' },
        h('div', {}, h('span', {}, '공유 폴더'), h('code', {}, info.folder)),
        h('div', {}, h('span', {}, '주소'), h('code', {}, addrs.join('  /  ') || '없음')),
        h('div', {}, h('span', {}, '연결 코드'), h('code', {}, info.key))),
      h('p', { class: 'hint' }, '이 폴더 안의 파일만 폰에서 보입니다. 처음 켤 때 윈도우 방화벽 창이 뜨면 "개인 네트워크"에 허용해 주세요.'),
      h('p', { class: 'hint warn-line' }, '⚠ 집·사무실처럼 믿을 수 있는 와이파이에서만 켜세요. 공용 와이파이에서는 쓰지 마세요.'),
      h('p', { class: 'hint' }, '연결 코드는 비밀번호와 같습니다. 다른 사람에게 보여주지 마세요. 새 코드를 만들면 기존에 연결한 폰은 다시 QR을 찍어야 합니다.'),
      h('button', { class: 'btn', onclick: async () => {
        if (!confirm('연결 코드를 새로 만들까요? 기존에 연결된 폰은 끊깁니다.')) return;
        const r = await fetch('/api/local/rotate', { method: 'PUT' });
        if (r.ok) { info = await r.json(); draw(); toast('새 연결 코드를 만들었습니다'); }
      } }, '새 연결 코드 만들기')));
  };
  await draw();
}

// PC 서버로 켜졌는지 (PC 화면에서 'PC 연결' 카드 문구를 정하는 데 사용)
export async function isPcServer() {
  if (isNative) return false;
  try { return (await fetch('/api/local/pair', { method: 'GET' })).ok; } catch { return false; }
}
