import { h } from './ui.js';

// 문서에서 나온 링크 무력화: javascript: 같은 위험한 주소는 지우고, 나머지는 새 창으로만 열리게
const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;
export function neutralizeLinks(root) {
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (!SAFE_HREF.test(href)) a.removeAttribute('href');
    else { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  });
  root.querySelectorAll('[onload],[onerror],[onclick],script,iframe,object,embed,form').forEach((el) => el.remove());
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

  toolbar.append(
    h('button', { title: '축소', onclick: () => { zoom = Math.max(0.4, zoom - 0.2); sizeAll(); } }, '－'),
    h('button', { title: '확대', onclick: () => { zoom = Math.min(3, zoom + 0.2); sizeAll(); } }, '＋'),
    h('button', { title: '화면 맞춤', onclick: () => { zoom = 1; sizeAll(); } }, '맞춤'),
    h('span', { class: 'sep' }),
    h('span', { style: 'color:var(--ink-2);padding:0 6px' }, `${doc.numPages}쪽`),
  );
  toolbar.hidden = false;
}

// ---------- DOCX (원본 서식 보기) ----------
export async function viewDocx(stage, data) {
  const { renderAsync } = await import('docx-preview');
  const host = h('div', { class: 'docx-host' });
  stage.append(host);
  await renderAsync(data, host, null, {
    className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true,
    experimental: true, renderHeaders: true, renderFooters: true, useBase64URL: true,
  });
  neutralizeLinks(host);
  // 좁은 화면이면 페이지를 화면 폭에 맞게 축소
  const fit = () => {
    host.querySelectorAll('section.docx').forEach((sec) => {
      sec.style.transform = '';
      const w = sec.offsetWidth;
      const avail = stage.clientWidth - 16;
      if (w > avail) {
        const s = avail / w;
        sec.style.transformOrigin = 'top left';
        sec.style.transform = `scale(${s})`;
        sec.style.marginBottom = `${-(1 - s) * sec.offsetHeight + 14}px`;
        sec.style.marginLeft = '8px';
      }
    });
  };
  fit();
  return fit;
}

// ---------- PPTX ----------
export async function viewPptx(stage, data) {
  const { init } = await import('pptx-preview');
  const host = h('div', { class: 'pptx-host' });
  stage.append(host);
  const width = Math.min(stage.clientWidth - 16, 960);
  const previewer = init(host, { width, height: Math.round(width * 9 / 16), mode: 'list' });
  await previewer.preview(data.slice(0));
  neutralizeLinks(host);
  // 일부 프로그램(구글 슬라이드·자동 생성 도구 등)이 만든 파일은 미리보기 부품이 못 그림 → 글자만이라도 보여줌
  if (!previewer.slideCount) {
    previewer.destroy?.();
    host.replaceChildren(await pptxTextFallback(data));
  }
  return () => previewer.destroy?.();
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
function loadRhwp() {
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

  toolbar.append(
    h('button', { title: '축소', onclick: () => { zoom = Math.max(0.4, zoom - 0.2); sizeAll(); } }, '－'),
    h('button', { title: '확대', onclick: () => { zoom = Math.min(3, zoom + 0.2); sizeAll(); } }, '＋'),
    h('button', { title: '화면 맞춤', onclick: () => { zoom = 1; sizeAll(); } }, '맞춤'),
    h('span', { class: 'sep' }),
    h('span', { style: 'color:var(--ink-2);padding:0 6px' }, `${total}쪽`),
  );
  toolbar.hidden = false;
  return () => { io.disconnect(); doc.free?.(); };
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
