// 최근 문서: 파일 내용까지 이 기기의 IndexedDB에만 보관 (외부 전송 없음)
const DB_NAME = 'clean-office';
const STORE = 'recent';
const MAX_ITEMS = 20;
const MAX_BYTES = 30 * 1024 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export async function listRecent() {
  try {
    const items = await tx('readonly', (s) => s.getAll());
    return items.sort((a, b) => b.openedAt - a.openedAt).map(({ data, ...meta }) => meta);
  } catch {
    return [];
  }
}

export async function getRecent(id) {
  return tx('readonly', (s) => s.get(id));
}

// extra: { src: 원래 위치 정보, key: 같은 파일 구분용 } — 다시 열 때 원래 위치에서 최신본을 읽고 거기에 저장
export async function saveRecent(name, data, extra) {
  if (data.byteLength > MAX_BYTES) return;
  try {
    const id = extra?.key || name;
    await tx('readwrite', (s) => s.put({ id, name, size: data.byteLength, openedAt: Date.now(), data, src: extra?.src }));
    const all = await listRecent();
    const overflow = all.slice(MAX_ITEMS);
    if (overflow.length) await tx('readwrite', (s) => overflow.forEach((x) => s.delete(x.id)));
  } catch (e) {
    // 저장 공간이 없거나 비공개 모드면 최근 목록만 건너뜀
    console.warn('최근 문서 저장 실패', e);
  }
}

export async function removeRecent(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export async function clearRecent() {
  return tx('readwrite', (s) => s.clear());
}
