// 이미지로 저장 · 뒤로가기 종료에 쓰는 계산만 모은 곳 (화면·브라우저 기능을 쓰지 않아 node 테스트로 확인 가능)

export const TARGET_DPI = 300;
// 한 장을 그릴 때 쓰는 최대 점 수. A4 300dpi(2480×3508 ≈ 870만 점)는 넉넉히 들어가고,
// 폰 메모리가 터지지 않게 한 장 최대 약 100MB(2500만 점 × 4바이트) 안으로 묶음
export const MAX_PIXELS = 25_000_000;
// 안드로이드 WebView·브라우저가 안정적으로 그리는 캔버스 한 변 최대
export const MAX_SIDE = 8192;

// 원하는 배율로 그리되, 너무 크면 점 수·한 변 제한 안으로 줄임
// w, h: 배율 1일 때 크기 / desired: 원하는 배율
export function fitScale(w, h, desired, { maxPixels = MAX_PIXELS, maxSide = MAX_SIDE } = {}) {
  if (!(w > 0) || !(h > 0)) throw new Error('페이지 크기를 알 수 없습니다');
  let s = desired;
  if (w * h * s * s > maxPixels) s = Math.sqrt(maxPixels / (w * h));
  if (w * s > maxSide) s = maxSide / w;
  if (h * s > maxSide) s = maxSide / h;
  return { scale: s, width: Math.floor(w * s), height: Math.floor(h * s), capped: s < desired - 1e-9 };
}

// 파일 이름에 못 쓰는 글자 정리
export function safeBase(name) {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (s || '문서').slice(0, 120);
}

// 원본이름_p001.png (1000쪽이 넘으면 자리 수를 늘림)
export function pageFileName(base, pageNo, total = 1) {
  const pad = Math.max(3, String(total).length);
  return `${safeBase(base)}_p${String(pageNo).padStart(pad, '0')}.png`;
}

// 저장할 쪽 고르기 → 0부터 세는 번호 목록 (작은 번호부터, 중복·범위 밖 제외)
// mode: 'current' | 'pick' | 'all'
export function resolvePages(mode, { total, current = 0, picked = [] }) {
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < total;
  if (mode === 'all') return Array.from({ length: total }, (_, i) => i);
  if (mode === 'current') return ok(current) ? [current] : total > 0 ? [0] : [];
  if (mode === 'pick') return [...new Set(picked.map(Number))].filter(ok).sort((a, b) => a - b);
  return [];
}

// "1-3, 5" 같은 쪽 번호 글자 → 0부터 세는 번호 목록
export function parseRanges(text, total) {
  const out = new Set();
  for (const part of String(text || '').split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:[-~](\d+))?$/);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let p = Math.max(1, a); p <= Math.min(total, b); p++) out.add(p - 1);
  }
  return [...out].sort((x, y) => x - y);
}

// 홈에서 뒤로가기 두 번 → 종료. press() 결과: 'hint'(안내만) | 'exit'(종료)
export function createBackExit({ windowMs = 2000, now = () => Date.now() } = {}) {
  let last = -Infinity;
  return {
    press() {
      const t = now();
      if (t - last <= windowMs) { last = -Infinity; return 'exit'; }
      last = t;
      return 'hint';
    },
    reset() { last = -Infinity; },
  };
}
