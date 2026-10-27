import { h } from './ui.js';

// ---------- 확대·축소 (버튼 · 두 손가락 벌리기 · Ctrl+휠) ----------
// apply(z): 실제로 그 배율로 다시 그리는 함수. 손가락으로 벌리는 동안은 화면만 늘였다가 손을 떼면 apply.
const ZMIN = 0.5;
const ZMAX = 4;
export function addZoom(stage, toolbar, apply, extra = []) {
  let zoom = 1;
  const label = h('span', { class: 'zoom-label' }, '100%');
  const set = (z) => {
    zoom = Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100));
    label.textContent = `${Math.round(zoom * 100)}%`;
    apply(zoom);
  };
  toolbar.append(
    h('button', { title: '축소', onclick: () => set(zoom / 1.25) }, '－'),
    label,
    h('button', { title: '확대', onclick: () => set(zoom * 1.25) }, '＋'),
    h('button', { title: '화면 맞춤', onclick: () => set(1) }, '맞춤'),
    ...extra,
  );
  toolbar.hidden = false;

  // 두 손가락 확대
  const content = () => stage.firstElementChild;
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onStart = (e) => {
    if (e.touches.length !== 2) return;
    const r = stage.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left + stage.scrollLeft;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top + stage.scrollTop;
    pinch = { d0: dist(e.touches), ratio: 1, cx, cy, sx: stage.scrollLeft, sy: stage.scrollTop };
    const el = content();
    if (el) el.style.transformOrigin = `${cx}px ${cy}px`;
  };
  const onMove = (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const ratio = Math.min(ZMAX / zoom, Math.max(ZMIN / zoom, dist(e.touches) / pinch.d0));
    pinch.ratio = ratio;
    const el = content();
    if (el) el.style.transform = `scale(${ratio})`;
  };
  const onEnd = () => {
    if (!pinch) return;
    const { ratio, cx, cy, sx, sy } = pinch;
    pinch = null;
    const el = content();
    if (el) { el.style.transform = ''; el.style.transformOrigin = ''; }
    if (Math.abs(ratio - 1) < 0.03) return;
    set(zoom * ratio);
    // 손가락 사이 지점이 화면에서 제자리에 있도록 스크롤 보정
    requestAnimationFrame(() => {
      stage.scrollLeft = cx * ratio - (cx - sx);
      stage.scrollTop = cy * ratio - (cy - sy);
    });
  };
  const onWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    set(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };
  stage.addEventListener('touchstart', onStart, { passive: true });
  stage.addEventListener('touchmove', onMove, { passive: false });
  stage.addEventListener('touchend', onEnd);
  stage.addEventListener('touchcancel', onEnd);
  stage.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    stage.removeEventListener('touchstart', onStart);
    stage.removeEventListener('touchmove', onMove);
    stage.removeEventListener('touchend', onEnd);
    stage.removeEventListener('touchcancel', onEnd);
    stage.removeEventListener('wheel', onWheel);
  };
}

// 문서에서 나온 링크 무력화: javascript: 같은 위험한 주소는 지우고, 나머지는 새 창으로만 열리게
const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;
export function neutralizeLinks(root) {
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (!SAFE_HREF.test(href)) a.removeAttribute('href');
    else { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  });
  root.querySelectorAll('script,iframe,object,embed,form,meta,link,base').forEach((el) => el.remove());
  // on* 이벤트 속성은 이름을 가리지 않고 모두 제거
  root.querySelectorAll('*').forEach((el) => { for (const at of [...el.attributes]) if (/^on/i.test(at.name)) el.removeAttribute(at.name); });
}

// 문서를 HTML로 바꾼 결과를 화면에 넣기 전 정화 (스크립트·이벤트·위험 링크 제거, 그림 data: 주소는 허용)
let purifyPromise;
export async function sanitizeHtml(html) {
  purifyPromise ??= import('dompurify').then((m) => m.default);
  const DOMPurify = await purifyPromise;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], ADD_ATTR: ['target'] });
}

// ---------- PDF ----------
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

export async function viewPdf(stage, data, toolbar) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
  const pages = h('div', { class: 'pages' });
  stage.append(pages);

  let zoom = 1;
  const holders = [];
  const baseWidth = () => Math.min(stage.clientWidth - 16, 900);

  for (let i = 1; i <= doc.numPages; i++) {
    const holder = h('div', { class: 'pdf-page', 'data-page': i }, h('span', { class: 'page-no' }, `${i} / ${doc.numPages}`));
    pages.append(holder);
    holders.push(holder);
  }
  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const ratio = vp1.height / vp1.width;

  const sizeAll = () => {
    const w = baseWidth() * zoom;
    holders.forEach((el) => { el.style.width = `${w}px`; el.style.minHeight = `${w * ratio}px`; el.dataset.rendered = ''; el.querySelector('canvas')?.remove(); });
    holders.forEach((el) => io.unobserve(el));
    holders.forEach((el) => io.observe(el));
  };

  async function render(el) {
    if (el.dataset.rendered) return;
    el.dataset.rendered = '1';
    const page = await doc.getPage(Number(el.dataset.page));
    const cssW = parseFloat(el.style.width);
    const vp = page.getViewport({ scale: 1 });
    const scale = (cssW / vp.width) * Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale });
    const canvas = h('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    el.querySelector('canvas')?.remove();
    el.prepend(canvas);
    el.style.minHeight = '';
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting && render(e.target));
  }, { root: stage, rootMargin: '600px 0px' });
  sizeAll();

  return addZoom(stage, toolbar, (z) => { zoom = z; sizeAll(); },
    [h('span', { class: 'sep' }), h('span', { style: 'color:var(--ink-2);padding:0 6px' }, `${doc.numPages}쪽`)]);
}

// ---------- DOCX (원본 서식 보기) ----------
export async function viewDocx(stage, data, toolbar) {
  const { renderAsync } = await import('docx-preview');
  const host = h('div', { class: 'docx-host' });
  stage.append(host);
  await renderAsync(data, host, null, {
    className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true,
    experimental: true, renderHeaders: true, renderFooters: true, useBase64URL: true,
  });
  neutralizeLinks(host);
  // 기본은 화면 폭에 맞춤(넓은 화면에선 원래 크기), 그 위에 사용자가 고른 배율을 곱함
  let zoom = 1;
  const fit = () => {
    host.querySelectorAll('section.docx').forEach((sec) => {
      sec.style.zoom = '';
      const w = sec.offsetWidth;
      const avail = stage.clientWidth - 16;
      const base = w > avail ? avail / w : 1;
      sec.style.zoom = String(base * zoom);
    });
  };
  fit();
  const stopZoom = addZoom(stage, toolbar, (z) => { zoom = z; fit(); });
  window.addEventListener('resize', fit);
  return () => { stopZoom(); window.removeEventListener('resize', fit); };
}

// ---------- PPTX ----------
export async function viewPptx(stage, data, toolbar) {
  // 편집기와 같은 렌더러로 그림 (상속된 글자 크기·글머리 기호·테마 색까지). 못 그리면 예전 부품으로
  try {
    return await viewPptxOwn(stage, data, toolbar);
  } catch (e) {
    console.warn('자체 슬라이드 그리기 실패, 예비 방식 사용', e);
    stage.replaceChildren();
  }
  const { init } = await import('pptx-preview');
  const host = h('div', { class: 'pptx-host' });
  stage.append(host);
  const width = Math.min(stage.clientWidth - 16, 960);
  const previewer = init(host, { width, height: Math.round(width * 9 / 16), mode: 'list' });
  await previewer.preview(await tidyPptx(data));
  neutralizeLinks(host);
  // 일부 프로그램(구글 슬라이드·자동 생성 도구 등)이 만든 파일은 미리보기 부품이 못 그림 → 글자만이라도 보여줌
  if (!previewer.slideCount) {
    previewer.destroy?.();
    host.replaceChildren(await pptxTextFallback(data));
  }
  const stopZoom = addZoom(stage, toolbar, (z) => { host.style.zoom = String(z); });
  return () => { stopZoom(); previewer.destroy?.(); };
}

async function viewPptxOwn(stage, data, toolbar) {
  const [{ openDeck }, { renderSlide, px }] = await Promise.all([import('./pptx-studio.js'), import('./pptx-render.js')]);
  const deck = await openDeck(data.slice(0));
  const sw = px(deck.size.cx);
  const sh = px(deck.size.cy);
  const host = h('div', { class: 'pv-host' });
  const items = deck.slides.map((s) => {
    const { el } = renderSlide(s, s.ctx, deck.size);
    const holder = h('div', { class: 'pv-slide' }, el);
    host.append(holder);
    return { holder, el };
  });
  stage.append(host);
  neutralizeLinks(host);
  let zoom = 1;
  const layout = () => {
    const k = (Math.min(stage.clientWidth - 24, 1100) / sw) * zoom;
    for (const { holder, el } of items) {
      holder.style.width = `${sw * k}px`;
      holder.style.height = `${sh * k}px`;
      el.style.transform = `scale(${k})`;
    }
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  const stopZoom = addZoom(stage, toolbar, (z) => { zoom = z; layout(); });
  return () => { stopZoom(); ro.disconnect(); for (const u of deck.urls.values()) URL.revokeObjectURL(u); };
}

// 자동 생성 도구(pptxgenjs 등)는 목록([Content_Types].xml)에 없는 부품을 적어 두기도 함.
// 파워포인트는 무시하지만 미리보기 부품은 통째로 실패하므로, 보기용 사본에서만 그 줄을 지움.
async function tidyPptx(data) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(data.slice(0));
    const ct = zip.file('[Content_Types].xml');
    if (!ct) return data.slice(0);
    const xml = await ct.async('text');
    const fixed = xml.replace(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g, (m, part) => (zip.file(part) ? m : ''));
    if (fixed === xml) return data.slice(0);
    zip.file('[Content_Types].xml', fixed);
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return data.slice(0);
  }
}

async function pptxTextFallback(data) {
  const { readPptxText } = await import('./pptx-editor.js');
  const slides = await readPptxText(data);
  return h('div', { class: 'pptx-fallback' },
    h('div', { class: 'legacy-banner' }, h('b', {}, '디자인 미리보기를 그리지 못해 글자만 보여 드립니다'), h('span', {}, '"편집"으로 글자를 고쳐 저장하면 디자인은 원본 그대로 유지됩니다.')),
    ...slides.map((s, i) => h('section', { class: 'slide-card' },
      h('div', { class: 'slide-head' }, h('b', {}, `슬라이드 ${i + 1}`)),
      ...s.map((t) => h('p', { class: 'fallback-text' }, t)))));
}

// ---------- HWP / HWPX (rhwp: Rust+WASM, 캔버스로만 그려서 문서 속 코드가 실행되지 않음) ----------
let rhwpPromise;
export function loadRhwp() {
  rhwpPromise ??= Promise.all([import('@rhwp/core'), import('@rhwp/core/rhwp_bg.wasm?url')]).then(async ([lib, wasm]) => {
    let ctx;
    let lastFont = '';
    globalThis.measureTextWidth = (font, text) => {
      ctx ??= document.createElement('canvas').getContext('2d');
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      return ctx.measureText(text).width;
    };
    await lib.default({ module_or_path: wasm.default });
    return lib;
  });
  return rhwpPromise;
}

export async function viewHwp(stage, data, toolbar) {
  const { HwpDocument } = await loadRhwp();
  const doc = new HwpDocument(new Uint8Array(data));
  const total = doc.pageCount();
  const pages = h('div', { class: 'pages' });
  stage.append(pages);

  const info = (i) => { try { return JSON.parse(doc.getPageInfo(i)); } catch { return {}; } };
  const first = info(0);
  const ratio = (first.height && first.width) ? first.height / first.width : 297 / 210;
  let zoom = 1;
  const holders = [];
  for (let i = 0; i < total; i++) {
    const holder = h('div', { class: 'pdf-page', 'data-page': i }, h('span', { class: 'page-no' }, `${i + 1} / ${total}`));
    pages.append(holder);
    holders.push(holder);
  }
  const baseWidth = () => Math.min(stage.clientWidth - 16, 900);

  function render(el) {
    if (el.dataset.rendered) return;
    el.dataset.rendered = '1';
    const i = Number(el.dataset.page);
    const pageW = info(i).width || first.width || 794;
    const scale = (parseFloat(el.style.width) / pageW) * Math.min(window.devicePixelRatio || 1, 2);
    const canvas = h('canvas');
    try {
      doc.renderPageToCanvas(i, canvas, scale);
    } catch (e) {
      console.error(e);
      el.dataset.rendered = '';
      return;
    }
    el.querySelector('canvas')?.remove();
    el.prepend(canvas);
    el.style.minHeight = '';
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting && render(e.target));
  }, { root: stage, rootMargin: '600px 0px' });

  const sizeAll = () => {
    const w = baseWidth() * zoom;
    holders.forEach((el) => {
      io.unobserve(el);
      el.style.width = `${w}px`;
      el.style.minHeight = `${w * ratio}px`;
      el.dataset.rendered = '';
      el.querySelector('canvas')?.remove();
      io.observe(el);
    });
  };
  sizeAll();

  const stopZoom = addZoom(stage, toolbar, (z) => { zoom = z; sizeAll(); },
    [h('span', { class: 'sep' }), h('span', { style: 'color:var(--ink-2);padding:0 6px' }, `${total}쪽`)]);
  return () => { stopZoom(); io.disconnect(); doc.free?.(); };
}

// ---------- 텍스트 / 이미지 ----------
export function viewText(stage, data) {
  const text = new TextDecoder('utf-8').decode(data);
  stage.append(h('div', { class: 'text-view' }, text));
}

export function viewImage(stage, data, name) {
  const url = URL.createObjectURL(new Blob([data]));
  stage.append(h('div', { class: 'img-view' }, h('img', { src: url, alt: name })));
}

export function viewNotice(stage, html) {
  stage.append(h('div', { class: 'notice', html }));
}
