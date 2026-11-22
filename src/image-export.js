// 이미지로 저장: 연 문서를 쪽(슬라이드)마다 고해상도 PNG(무손실)로 다시 그려 저장
// - 화면에 보이는 그림을 찍는 게 아니라, 원본에서 약 300dpi로 새로 그림 → 글자가 선명
// - 폰 메모리가 터지지 않게 한 장씩 그림 → 저장 → 캔버스 비우기
import { h, toast, busy } from './ui.js';
import { isNative, DocFiles, blobToBase64, saveAs } from './files.js';
import { TARGET_DPI, fitScale, pageFileName, resolvePages, parseRanges } from './image-plan.js';

// ---------- 형식별 '쪽' 그리기 ----------
// 각 source: { unit, open() → { count, render(i) → { canvas, capped }, close() }, currentIndex() }

// 화면 가운데에 걸친 쪽 번호(0부터)
function visibleIndex(stage, els) {
  if (!els.length) return 0;
  const r = stage.getBoundingClientRect();
  const mid = r.top + Math.min(r.height, window.innerHeight) / 2;
  let best = 0;
  let bestDist = Infinity;
  els.forEach((el, i) => {
    const b = el.getBoundingClientRect();
    const d = mid < b.top ? b.top - mid : mid > b.bottom ? mid - b.bottom : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// 투명한 곳은 흰 바탕으로 (PNG에 투명 배경이 남으면 사진 앱에서 검게 보임)
// 미리보기(썸네일·크게 보기)용 화면 배율: 폰 메모리를 아끼려고 최대 2배
const previewDpr = () => Math.min(window.devicePixelRatio || 1, 2);

function whiteBehind(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function pdfSource(data, stage) {
  return {
    unit: '쪽',
    currentIndex: () => visibleIndex(stage, [...stage.querySelectorAll('.pdf-page')]),
    async open() {
      const { loadPdfjs } = await import('./viewers.js');
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
      const vpFirst = (await doc.getPage(1)).getViewport({ scale: 1 });
      return {
        count: doc.numPages,
        ratio: vpFirst.height / vpFirst.width,
        // 미리보기: 화면 폭(cssW)에 맞춰 낮은 해상도로 그림
        async preview(i, cssW) {
          const page = await doc.getPage(i + 1);
          const vp1 = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (cssW * previewDpr()) / vp1.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          return { el: canvas, ratio: vp1.height / vp1.width };
        },
        async render(i) {
          const page = await doc.getPage(i + 1);
          const vp1 = page.getViewport({ scale: 1 }); // PDF 단위: 1/72인치
          const fit = fitScale(vp1.width, vp1.height, TARGET_DPI / 72);
          const viewport = page.getViewport({ scale: fit.scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          page.cleanup();
          return { canvas, capped: fit.capped };
        },
        close: () => doc.destroy(),
      };
    },
  };
}

function hwpSource(data, stage) {
  return {
    unit: '쪽',
    currentIndex: () => visibleIndex(stage, [...stage.querySelectorAll('.pdf-page')]),
    async open() {
      const { loadRhwp } = await import('./viewers.js');
      const { HwpDocument } = await loadRhwp();
      // 보기 화면과 따로 문서를 하나 더 엶 (저장 중에 화면을 닫아도 안전)
      const doc = new HwpDocument(new Uint8Array(data.slice(0)));
      const size = (i) => {
        let info = {};
        try { info = JSON.parse(doc.getPageInfo(i)); } catch { /* 기본값 */ }
        return { w: info.width || 794, hh: info.height || 1123 };
      };
      const s0 = size(0);
      return {
        count: doc.pageCount(),
        ratio: s0.hh / s0.w,
        async preview(i, cssW) {
          const { w, hh } = size(i);
          const canvas = document.createElement('canvas');
          doc.renderPageToCanvas(i, canvas, (cssW * previewDpr()) / w);
          whiteBehind(canvas);
          return { el: canvas, ratio: hh / w };
        },
        async render(i) {
          const { w, hh } = size(i);
          const fit = fitScale(w, hh, TARGET_DPI / 96); // 한글 엔진 단위: 1/96인치(px)
          const canvas = document.createElement('canvas');
          doc.renderPageToCanvas(i, canvas, fit.scale);
          whiteBehind(canvas);
          return { canvas, capped: fit.capped };
        },
        close: () => doc.free?.(),
      };
    },
  };
}

// 화면 밖에서 그림을 캔버스로 옮김 (글자는 캔버스에 직접 새로 써서 확대해도 선명)
async function domToCanvas(el, w, hh, scale, ignoreStage) {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(el, {
    scale, width: w, height: hh, backgroundColor: '#ffffff', useCORS: true, logging: false,
    ignoreElements: ignoreStage ? (n) => n.id === 'stage' : undefined,
  });
}

// 도형 테두리는 화면에선 상자 밖으로 삐져나와 보이지만(overflow: visible) html2canvas는 상자에서 잘라 버림.
// 저장용 사본에서만 그림 상자를 테두리 두께만큼 넓혀 잘리지 않게 함
function padShapeStrokes(root) {
  root.querySelectorAll('svg.sl-geom').forEach((svg) => {
    const widths = [...svg.querySelectorAll('[stroke-width]')].map((n) => parseFloat(n.getAttribute('stroke-width')) || 0);
    if (!widths.length) return;
    const p = Math.ceil(Math.max(...widths) / 2) + 2;
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) return;
    svg.setAttribute('viewBox', `${vb[0] - p} ${vb[1] - p} ${vb[2] + 2 * p} ${vb[3] + 2 * p}`);
    svg.setAttribute('width', vb[2] + 2 * p);
    svg.setAttribute('height', vb[3] + 2 * p);
    svg.style.inset = `${-p}px`;
    svg.style.width = `calc(100% + ${2 * p}px)`;
    svg.style.height = `calc(100% + ${2 * p}px)`;
  });
}

function pptxSource(data, stage) {
  return {
    unit: '슬라이드',
    currentIndex: () => visibleIndex(stage, [...stage.querySelectorAll('.pv-slide')]),
    async open() {
      const [{ openDeck }, { renderSlide, px }, { neutralizeLinks }] = await Promise.all([import('./pptx-studio.js'), import('./pptx-render.js'), import('./viewers.js')]);
      const deck = await openDeck(data.slice(0));
      const sw = px(deck.size.cx);
      const sh = px(deck.size.cy);
      return {
        count: deck.slides.length,
        ratio: sh / sw,
        // 미리보기: 슬라이드를 화면 요소로 그려 축소 (그림으로 바꾸지 않아 빠르고 선명)
        async preview(i, cssW) {
          const s = deck.slides[i];
          const { el } = renderSlide(s, s.ctx, deck.size);
          const k = cssW / sw;
          el.style.transform = `scale(${k})`;
          const box = h('div', { class: 'ie-dom-page', style: `width:${cssW}px;height:${sh * k}px` }, el);
          neutralizeLinks(box);
          return { el: box, ratio: sh / sw };
        },
        async render(i) {
          const s = deck.slides[i];
          const { el } = renderSlide(s, s.ctx, deck.size);
          const holder = h('div', { class: 'pv-slide img-export-slide', style: `width:${sw}px;height:${sh}px` }, el);
          const wrap = h('div', { class: 'img-export-offscreen' }, holder);
          neutralizeLinks(wrap);
          padShapeStrokes(wrap);
          document.body.append(wrap);
          try {
            await Promise.all([...wrap.querySelectorAll('img')].map((img) => (img.complete ? null : img.decode().catch(() => {}))));
            // 슬라이드 단위(96dpi px) 기준 300dpi. 16:9(1280px)이면 약 4000px 폭
            const fit = fitScale(sw, sh, TARGET_DPI / 96);
            const canvas = await domToCanvas(holder, sw, sh, fit.scale, true);
            return { canvas, capped: fit.capped };
          } finally {
            wrap.remove();
          }
        },
        close: () => { for (const u of deck.urls.values()) URL.revokeObjectURL(u); },
      };
    },
  };
}

// DOCX: 워드 파일에는 '쪽'이 저장돼 있지 않아, 보기 화면의 쪽(section)을 A4 등 용지 높이로 다시 나눔.
// 문단·표 줄이 끝나는 곳에서 자르므로 글자가 반으로 잘리지 않음. 워드의 실제 쪽 나눔과는 조금 다를 수 있음
function docxSource(stage) {
  const sections = () => [...stage.querySelectorAll('section.docx')];
  // 화면 맞춤 배율을 잠시 풀고 원래 크기로 재거나 그림
  const unzoomed = async (fn) => {
    const list = sections();
    const prev = list.map((sec) => sec.style.zoom);
    list.forEach((sec) => { sec.style.zoom = ''; });
    try { return await fn(list); } finally { list.forEach((sec, k) => { sec.style.zoom = prev[k]; }); }
  };
  const measure = () => unzoomed((list) => {
    const pages = [];
    list.forEach((sec, si) => {
      const cs = getComputedStyle(sec);
      const w = sec.offsetWidth;
      const H = sec.offsetHeight;
      const pageH = parseFloat(cs.minHeight) || (w * 297) / 210;
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      if (H <= pageH * 1.02) { pages.push({ si, w, pageH, start: 0, end: H, dest: 0 }); return; }
      const top = sec.getBoundingClientRect().top;
      const cuts = [...new Set([...sec.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6, img, table')]
        .map((el) => Math.round(el.getBoundingClientRect().bottom - top)))].sort((a, b) => a - b);
      const avail = pageH - padT - padB;
      const contentEnd = H - padB;
      let y = 0;
      let first = true;
      while (y < contentEnd - 1) {
        const room = first ? pageH - padB : y + avail; // 첫 쪽은 위 여백을 포함해서 셈
        const limit = Math.min(room, contentEnd);
        let cut = limit >= contentEnd ? contentEnd : 0;
        if (!cut) for (const c of cuts) { if (c > y + 20 && c <= limit) cut = c; }
        if (!cut) cut = limit; // 한 문단이 한 쪽보다 길면 그냥 용지 높이에서 자름
        pages.push({ si, w, pageH, start: y, end: cut, dest: first ? 0 : padT });
        y = cut;
        first = false;
      }
    });
    return pages;
  });
  return {
    unit: '쪽',
    currentIndex: () => visibleIndex(stage, sections()), // 아래 open에서 나눈 쪽 번호로 바꿈
    async open() {
      const pages = await measure();
      // 화면에서 보던 section → 그 section의 첫 쪽
      const firstOf = (si) => Math.max(0, pages.findIndex((p) => p.si === si));
      const viewIdx = this.currentIndex;
      this.currentIndex = () => firstOf(viewIdx());
      return {
        count: pages.length,
        ratio: pages[0] ? pages[0].pageH / pages[0].w : 297 / 210,
        // 미리보기: 그 쪽에 해당하는 부분만 보이게 문서 화면을 복사해 축소
        async preview(i, cssW) {
          const pg = pages[i];
          const sec = sections()[pg.si];
          if (!sec) throw new Error('문서 화면이 닫혔습니다');
          const k = cssW / pg.w;
          const copy = sec.cloneNode(true);
          copy.style.zoom = '';
          copy.style.margin = '0';
          copy.style.boxShadow = 'none';
          copy.style.position = 'absolute';
          copy.style.left = '0';
          copy.style.top = `${-pg.start}px`;
          const clip = h('div', { style: `position:absolute;left:0;top:${pg.dest}px;width:${pg.w}px;height:${pg.end - pg.start}px;overflow:hidden` }, copy);
          const paper = h('div', { class: 'docx-wrapper ie-docx-paper', style: `width:${pg.w}px;height:${pg.pageH}px;transform:scale(${k})` }, clip);
          return { el: h('div', { class: 'ie-dom-page', style: `width:${cssW}px;height:${pg.pageH * k}px` }, paper), ratio: pg.pageH / pg.w };
        },
        async render(i) {
          const pg = pages[i];
          return unzoomed(async (list) => {
            const sec = list[pg.si];
            if (!sec?.isConnected) throw new Error('문서 화면이 닫혔습니다');
            const fit = fitScale(pg.w, pg.pageH, TARGET_DPI / 96);
            const stripH = pg.end - pg.start;
            const { default: html2canvas } = await import('html2canvas');
            const strip = await html2canvas(sec, { scale: fit.scale, x: 0, y: pg.start, width: pg.w, height: stripH, backgroundColor: '#ffffff', useCORS: true, logging: false });
            const canvas = document.createElement('canvas');
            canvas.width = fit.width;
            canvas.height = Math.max(fit.height, Math.ceil((pg.dest + stripH) * fit.scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(strip, 0, Math.round(pg.dest * fit.scale));
            strip.width = 0;
            strip.height = 0;
            return { canvas, capped: fit.capped };
          });
        },
        close() {},
      };
    },
  };
}

// 형식별 지원 여부. 안 되면 { reason }
export function imageSourceFor(ext, data, stage) {
  if (ext === 'pdf') return pdfSource(data, stage);
  if (ext === 'hwp' || ext === 'hwpx') return hwpSource(data, stage);
  if (ext === 'pptx') {
    // 예비 미리보기(글자만 보기 등)로 열린 파일은 원본 그대로 다시 그릴 수 없음
    if (!stage.querySelector('.pv-host')) return { reason: '이 슬라이드 파일은 디자인을 그대로 그리지 못해 이미지로 저장할 수 없어요' };
    return pptxSource(data, stage);
  }
  if (ext === 'docx') return stage.querySelector('section.docx') ? docxSource(stage) : { reason: '문서 쪽을 찾지 못했어요' };
  return { reason: '이 형식은 이미지로 저장할 수 없어요' };
}

// ---------- 저장할 곳 ----------
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 저장 방식: 안드로이드는 사진 폴더, PC·웹은 다운로드
async function makeSink() {
  if (isNative) {
    let fallback = false;
    return {
      where: '사진 앱의 Pictures/CleanOffice 폴더',
      async save(name, blob) {
        if (!fallback) {
          try {
            await DocFiles.saveImage({ name, mime: 'image/png', data: await blobToBase64(blob) });
            return true;
          } catch (e) {
            // 안드로이드 9 이하 등: 사진 폴더에 바로 못 쓰면 파일 선택창으로 한 장씩
            fallback = true;
            toast('사진 폴더에 바로 저장할 수 없어 저장할 곳을 한 장씩 고릅니다', 3500);
            console.warn('saveImage 실패', e);
          }
        }
        return Boolean(await saveAs(name, blob));
      },
    };
  }
  return {
    where: '다운로드 폴더',
    async save(name, blob) {
      download(name, blob);
      await new Promise((r) => setTimeout(r, 350)); // 여러 장을 연달아 받을 때 브라우저가 놓치지 않게
      return true;
    },
  };
}

// ---------- 고르기 창 (인쇄 미리보기처럼 쪽 그림을 보며 고르기) ----------
// 썸네일은 화면에 보이는 것만 낮은 해상도로 하나씩 그림.
// 캔버스로 그린 것(PDF·한글)은 작은 JPEG로 바꿔 보관(캐시)하고, 화면 요소로 그린 것(슬라이드·워드)은 보일 때만 붙임
function thumbGrid({ total, unit, opened, picked, onChange, onZoom }) {
  const urls = [];
  const cards = [];
  const state = Array.from({ length: total }, () => ({ done: false, dom: false }));
  const visible = new Set();
  const queue = [];
  let pumping = false;
  let closed = false;
  let inflight = Promise.resolve();
  const grid = h('div', { class: 'ie-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': `${unit} 고르기` });

  const drawOne = async (i) => {
    const box = cards[i].querySelector('.ie-thumb');
    const cssW = Math.max(60, Math.round(box.clientWidth || 140));
    const r = await opened.preview(i, cssW);
    if (closed) { if (r.el instanceof HTMLCanvasElement) { r.el.width = 0; r.el.height = 0; } return; }
    box.style.aspectRatio = String(1 / r.ratio);
    if (r.el instanceof HTMLCanvasElement) {
      const blob = await new Promise((res) => r.el.toBlob(res, 'image/jpeg', 0.85));
      r.el.width = 0;
      r.el.height = 0;
      if (!blob || closed) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      box.replaceChildren(h('img', { src: url, alt: `${i + 1}번째 ${unit}`, draggable: 'false' }));
      state[i].done = true;
    } else {
      box.replaceChildren(r.el);
      state[i].done = true;
      state[i].dom = true;
    }
  };
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length && !closed) {
      const i = queue.shift();
      if (!visible.has(i) || state[i].done) continue;
      inflight = drawOne(i).catch((e) => { console.warn('썸네일 실패', e); cards[i].querySelector('.ie-thumb').classList.add('err'); });
      await inflight;
    }
    pumping = false;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = Number(e.target.dataset.i);
      if (e.isIntersecting) {
        visible.add(i);
        if (!state[i].done && !queue.includes(i)) queue.push(i);
      } else {
        visible.delete(i);
        // 화면 요소로 그린 썸네일은 멀어지면 떼어 메모리 아끼기 (다시 보이면 새로 그림)
        if (state[i].dom) { e.target.querySelector('.ie-thumb').replaceChildren(); state[i].done = false; state[i].dom = false; }
      }
    }
    pump();
  }, { root: grid, rootMargin: '300px 0px' });

  for (let i = 0; i < total; i++) {
    let timer = 0;
    let longPressed = false;
    const toggle = () => { if (picked.has(i)) picked.delete(i); else picked.add(i); onChange(); };
    const card = h('div', {
      class: 'ie-card', role: 'option', tabindex: '0', 'data-i': i, 'aria-label': `${i + 1}번째 ${unit}`,
      onclick: () => { if (longPressed) { longPressed = false; return; } toggle(); },
      onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } },
      oncontextmenu: (e) => e.preventDefault(),
      onpointerdown: (e) => {
        if (e.target.closest('.ie-zoom')) return;
        longPressed = false;
        clearTimeout(timer);
        timer = setTimeout(() => { longPressed = true; onZoom(i); }, 550); // 길게 누르면 크게 보기
      },
      onpointerup: () => clearTimeout(timer),
      onpointerleave: () => clearTimeout(timer),
      onpointercancel: () => clearTimeout(timer),
    },
    h('div', { class: 'ie-frame' },
      h('div', { class: 'ie-thumb', style: `aspect-ratio:${1 / opened.ratio}` }, h('span', { class: 'ie-spin' })),
      h('span', { class: 'ie-check', 'aria-hidden': 'true' }, '✓'),
      h('button', { type: 'button', class: 'ie-zoom', title: '크게 보기', 'aria-label': `${i + 1}번째 ${unit} 크게 보기`, onclick: (e) => { e.stopPropagation(); onZoom(i); } }, zoomIcon())),
    h('span', { class: 'ie-no' }, String(i + 1)));
    cards.push(card);
    grid.append(card);
  }
  return {
    el: grid,
    start() { cards.forEach((c) => io.observe(c)); },
    sync() { cards.forEach((c, i) => { c.classList.toggle('on', picked.has(i)); c.setAttribute('aria-selected', String(picked.has(i))); }); },
    scrollTo(i) { cards[i]?.scrollIntoView({ block: 'center' }); },
    // 창을 닫을 때: 그리던 것은 끝까지 기다리고, 보관한 썸네일은 버림
    async close() { closed = true; io.disconnect(); await inflight; urls.forEach((u) => URL.revokeObjectURL(u)); },
  };
}

function zoomIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6');
  svg.append(p);
  return svg;
}

// 크게 보기: 한 쪽을 화면 폭에 맞춰 그림. 앞뒤로 넘기며 선택/해제
function bigView({ start, total, unit, opened, picked, onChange }) {
  let i = start;
  let token = 0;
  let canvasEl = null;
  const body = h('div', { class: 'ie-big-body' });
  const title = h('b', { class: 'modal-title' });
  const pickBtn = h('button', { class: 'btn primary', onclick: () => { if (picked.has(i)) picked.delete(i); else picked.add(i); onChange(); sync(); } });
  const prev = h('button', { class: 'btn ie-nav', title: '이전', 'aria-label': `이전 ${unit}`, onclick: () => go(i - 1) }, '‹');
  const next = h('button', { class: 'btn ie-nav', title: '다음', 'aria-label': `다음 ${unit}`, onclick: () => go(i + 1) }, '›');
  const free = () => { if (canvasEl) { canvasEl.width = 0; canvasEl.height = 0; canvasEl = null; } };
  const close = () => { token++; free(); wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowLeft') go(i - 1);
    if (e.key === 'ArrowRight') go(i + 1);
  };
  function sync() {
    title.textContent = `${i + 1} / ${total} ${unit}`;
    pickBtn.textContent = picked.has(i) ? '✓ 선택됨' : '선택하기';
    pickBtn.classList.toggle('ie-unpicked', !picked.has(i));
    prev.disabled = i <= 0;
    next.disabled = i >= total - 1;
  }
  async function go(n) {
    if (n < 0 || n >= total) return;
    i = n;
    sync();
    const my = ++token;
    free();
    body.replaceChildren(h('span', { class: 'ie-spin' }));
    const cssW = Math.max(200, Math.min((body.clientWidth || 600) - 8, 900));
    try {
      const r = await opened.preview(i, cssW);
      if (my !== token) { if (r.el instanceof HTMLCanvasElement) { r.el.width = 0; r.el.height = 0; } return; }
      if (r.el instanceof HTMLCanvasElement) { canvasEl = r.el; r.el.style.width = `${cssW}px`; }
      body.replaceChildren(h('div', { class: 'ie-big-page' }, r.el));
    } catch (e) {
      if (my === token) body.replaceChildren(h('p', { class: 'modal-msg' }, `그리지 못했어요: ${e.message || e}`));
    }
  }
  // 닫기 단추를 맨 앞에 둠 → 안드로이드 뒤로가기(closeModal)가 이 창만 닫음
  const wrap = h('div', { class: 'modal-wrap ie-big-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal ie-big', role: 'dialog', 'aria-modal': 'true', 'aria-label': '크게 보기' },
      title, body,
      h('div', { class: 'modal-btns' }, h('button', { class: 'btn', onclick: close }, '닫기'), prev, next, pickBtn)));
  document.body.append(wrap);
  document.addEventListener('keydown', onKey, true);
  go(i);
}

function chooseDialog({ total, current, unit, opened }) {
  return new Promise((resolve) => {
    let mode = 'current';
    const picked = new Set([current]);
    let grid = null;
    const done = async (v) => {
      wrap.remove();
      document.querySelector('.ie-big-wrap')?.remove();
      document.removeEventListener('keydown', onKey);
      await grid?.close(); // 썸네일 그리던 것이 끝난 뒤 저장 시작
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.ie-big-wrap')) done(null); };

    const countEl = h('span', { class: 'ie-count' });
    const rangeIn = h('input', { class: 'ie-range', type: 'text', inputmode: 'numeric', placeholder: '번호 (예: 1-3, 5)', 'aria-label': '번호로 고르기' });
    rangeIn.addEventListener('input', () => {
      const list = parseRanges(rangeIn.value, total);
      if (!list.length) return;
      picked.clear();
      list.forEach((i) => picked.add(i));
      sync(false);
    });
    const allBtn = h('button', { type: 'button', class: 'btn ie-small', onclick: () => { if (picked.size === total) picked.clear(); else for (let i = 0; i < total; i++) picked.add(i); sync(); } }, '모두 선택');
    const pickBox = h('div', { class: 'ie-pick', hidden: true },
      h('div', { class: 'ie-pick-head' }, countEl, rangeIn, allBtn),
      h('p', { class: 'ie-hint' }, '눌러서 고르고, 길게 누르거나 돋보기를 누르면 크게 볼 수 있어요'));

    const opt = (value, label, sub) => {
      const input = h('input', { type: 'radio', name: 'ie-mode', value, checked: value === mode });
      input.addEventListener('change', () => { mode = value; sync(); });
      return h('label', { class: 'ie-opt' }, input, h('span', {}, h('b', {}, label), sub ? h('small', {}, sub) : null));
    };
    const okBtn = h('button', { class: 'btn primary', onclick: () => {
      const pages = resolvePages(mode, { total, current, picked: [...picked] });
      if (!pages.length) return toast(`저장할 ${unit}를 골라 주세요`);
      done({ mode, pages });
    } }, '저장');

    const modal = h('div', { class: 'modal ie-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '이미지로 저장' },
      h('b', { class: 'modal-title' }, '이미지로 저장'),
      h('p', { class: 'modal-msg ie-intro' }, `PNG(화질 손실 없음)로, 화면 배율이 아니라 원본에서 약 ${TARGET_DPI}dpi로 다시 그려 저장해요.`),
      h('div', { class: 'ie-opts' },
        opt('current', `지금 보는 ${unit}`, `${current + 1}번째`),
        opt('pick', `${unit} 골라서`, '그림을 보며 고르기'),
        opt('all', '전체', `${total}장`)),
      pickBox,
      h('div', { class: 'modal-btns' },
        h('button', { class: 'btn', onclick: () => done(null) }, '취소'),
        okBtn));

    function sync(rewriteRange = true) {
      const picking = mode === 'pick';
      pickBox.hidden = !picking;
      modal.classList.toggle('wide', picking);
      if (picking && !grid) {
        grid = thumbGrid({
          total, unit, opened, picked,
          onChange: () => sync(),
          onZoom: (i) => bigView({ start: i, total, unit, opened, picked, onChange: () => sync() }),
        });
        pickBox.append(grid.el);
        requestAnimationFrame(() => { grid.start(); grid.scrollTo(current); });
      }
      grid?.sync();
      allBtn.textContent = picked.size === total ? '모두 해제' : '모두 선택';
      countEl.textContent = `${picked.size}장 선택됨`;
      if (rewriteRange && document.activeElement !== rangeIn) rangeIn.value = '';
      const n = mode === 'all' ? total : picking ? picked.size : 1;
      okBtn.textContent = `${n}장 저장`;
    }

    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) done(null); } }, modal);
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    sync();
    okBtn.focus();
  });
}

// 진행 창 (취소 단추 = 뒤로가기로도 닫힘)
function progressDialog() {
  const state = { cancelled: false };
  const text = h('p', { class: 'modal-msg' }, '준비 중…');
  const bar = h('div', { class: 'ie-bar' }, h('i'));
  const wrap = h('div', { class: 'modal-wrap' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '이미지 저장 중' },
      h('b', { class: 'modal-title' }, '이미지로 저장 중'), text, bar,
      h('div', { class: 'modal-btns' }, h('button', { class: 'btn', onclick: () => { state.cancelled = true; text.textContent = '멈추는 중…'; } }, '그만하기'))));
  document.body.append(wrap);
  return {
    state,
    set(done, total, msg) { text.textContent = msg; bar.firstChild.style.width = `${Math.round((done / total) * 100)}%`; },
    close: () => wrap.remove(),
  };
}

const canvasToPng = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그림을 만들지 못했습니다(메모리 부족일 수 있음)'))), 'image/png'));

// ---------- 전체 흐름 ----------
// isAlive(): 문서 화면이 아직 열려 있는지 (닫히면 멈춤)
let running = false;
export async function saveAsImages({ name, source, isAlive = () => true }) {
  if (running) return; // 두 번 눌러 창이 겹치지 않게
  running = true;
  let job;
  let opened;
  let total = 0;
  try {
    busy(true, '이미지 저장 준비 중…');
    try { opened = await source.open(); } finally { busy(false); }
    total = opened.count;
    if (!total) { toast('저장할 쪽이 없어요'); return; }
    const choice = await chooseDialog({ total, current: Math.min(source.currentIndex(), total - 1), unit: source.unit, opened });
    if (!choice) return;
    const sink = await makeSink();
    job = progressDialog();
    const base = name.replace(/\.[^.]+$/, '');
    let saved = 0;
    let lastSize = '';
    let capped = false;
    for (const [k, i] of choice.pages.entries()) {
      if (job.state.cancelled || !isAlive()) break;
      job.set(k, choice.pages.length, `${k + 1} / ${choice.pages.length}장 그리는 중… (${i + 1}번째 ${source.unit})`);
      await new Promise((r) => setTimeout(r, 0)); // 진행 글자가 먼저 보이게
      const r = await opened.render(i);
      let blob;
      try {
        lastSize = `${r.canvas.width}×${r.canvas.height}`;
        // 용지가 지나치게 커서 메모리 한도 때문에 많이 줄여야 하면 흐린 그림을 저장하지 않고 알림
        if (r.capped && Math.min(r.canvas.width, r.canvas.height) < 1000) throw new Error(`${i + 1}번째 ${source.unit}가 너무 커서 선명하게 저장할 수 없어요`);
        capped ||= r.capped;
        blob = await canvasToPng(r.canvas);
      } finally {
        r.canvas.width = 0; // 메모리 바로 돌려주기
        r.canvas.height = 0;
      }
      if (job.state.cancelled) break; // 그리는 중에 '그만하기'를 눌렀으면 이 장도 저장하지 않음
      const ok = await sink.save(pageFileName(base, i + 1, total), blob);
      blob = null;
      if (!ok) break; // 파일 선택창에서 취소
      saved++;
    }
    job.close();
    job = null;
    if (saved) toast(`${saved}장을 ${sink.where}에 저장했어요 (PNG ${lastSize}${capped ? ', 너무 커서 일부 줄임' : ''})`, 4500);
    else toast('저장하지 않았어요');
  } catch (e) {
    console.error(e);
    toast(`이미지로 저장하지 못했어요: ${e.message || e}`, 5000);
  } finally {
    job?.close();
    try { opened?.close(); } catch { /* 이미 닫힘 */ }
    running = false;
  }
}
