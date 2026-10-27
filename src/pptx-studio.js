// 파워포인트 상세 편집: 슬라이드 화면에서 바로 고치기
// - 도형·글상자·그림 선택 → 끌어서 옮기기, 모서리로 크기 바꾸기, 두 번 눌러 글자 고치기
// - 글상자·도형·그림 넣기, 복제·삭제·앞뒤 순서, 채우기 색
// - 왼쪽(휴대폰은 위쪽) 슬라이드 목록: 새 슬라이드(레이아웃 선택)·복제·삭제·순서
// 파일 구조는 공개 표준(ECMA-376)대로 직접 읽고 씀. 바꾸지 않은 부분은 원본 그대로 둠.
import { h, toast, icon, menu } from './ui.js';
import { buildRichToolbar } from './rich-toolbar.js';
import { writeParagraph } from './pptx-editor.js';
import {
  NS, EMU_PX, px, kids, kid, first, resolvePath, relsPathOf, renderSlide, effectiveXfrm, xfrmElOf, phOf, spTreeOf, SHAPE_TAGS, setPurifier,
} from './pptx-render.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
const serialize = (doc) => XML_HEAD + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const T = { layout: `${REL}/slideLayout`, master: `${REL}/slideMaster`, theme: `${REL}/theme`, image: `${REL}/image`, notes: `${REL}/notesSlide`, slide: `${REL}/slide` };
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const IMG_CT = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif' };
const SHAPES = [['rect', '사각형'], ['roundRect', '둥근 사각형'], ['ellipse', '원'], ['triangle', '삼각형'], ['diamond', '마름모'], ['rightArrow', '오른쪽 화살표'], ['star5', '별'], ['line', '선']];

function relTarget(from, to) {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

// 파일 읽기: 슬라이드·레이아웃·마스터·테마·그림을 모두 불러 둠 (보기 화면과 편집기가 함께 씀)
export async function openDeck(data) {
  const [JSZip, DOMPurify] = await Promise.all([import('jszip').then((m) => m.default), import('dompurify').then((m) => m.default)]);
  setPurifier(DOMPurify);
  const zip = await JSZip.loadAsync(data);
  const read = async (path) => { const f = zip.file(path); if (!f) throw new Error(`파일 구성요소가 없습니다: ${path}`); return f.async('string'); };

  // ---------- 불러오기 ----------
  const parts = new Map(); // path → { path, doc, relsDoc, rels: Map(id → {type, target}) }
  async function loadPart(path) {
    if (parts.has(path)) return parts.get(path);
    const doc = parse(await read(path));
    const rf = zip.file(relsPathOf(path));
    const relsDoc = rf ? parse(await rf.async('string')) : null;
    const part = { path, doc, relsDoc, rels: relMap(path, relsDoc) };
    parts.set(path, part);
    return part;
  }
  function relMap(path, relsDoc) {
    const m = new Map();
    for (const r of relsDoc ? relsDoc.getElementsByTagNameNS(NS.rel, 'Relationship') : []) {
      m.set(r.getAttribute('Id'), { type: r.getAttribute('Type'), target: r.getAttribute('TargetMode') === 'External' ? null : resolvePath(path, r.getAttribute('Target')) });
    }
    return m;
  }
  const relOfType = (part, type) => [...part.rels.values()].find((r) => r.type === type)?.target;

  const presPath = 'ppt/presentation.xml';
  const pres = parse(await read(presPath));
  const presRels = parse(await read(relsPathOf(presPath)));
  const presRelById = new Map([...presRels.getElementsByTagNameNS(NS.rel, 'Relationship')].map((r) => [r.getAttribute('Id'), r]));
  const sldSzEl = first(pres, NS.p, 'sldSz');
  const size = { cx: Number(sldSzEl?.getAttribute('cx') || 12192000), cy: Number(sldSzEl?.getAttribute('cy') || 6858000) };
  const defaultTextStyle = first(pres, NS.p, 'defaultTextStyle');
  let sldIdLst = first(pres, NS.p, 'sldIdLst');
  if (!sldIdLst) { sldIdLst = pres.createElementNS(NS.p, 'p:sldIdLst'); pres.documentElement.insertBefore(sldIdLst, first(pres, NS.p, 'sldSz')); }

  // 그림: 모든 media 를 미리 화면용 주소로
  const urls = new Map();
  await Promise.all(Object.keys(zip.files).filter((p) => p.startsWith('ppt/media/')).map(async (p) => {
    const ext = p.split('.').pop().toLowerCase();
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }[ext];
    if (!type) return;
    urls.set(p, URL.createObjectURL(new Blob([await zip.file(p).async('arraybuffer')], { type })));
  }));

  // 슬라이드·레이아웃·마스터·테마
  const ctxCache = new Map();
  async function contextFor(slidePart) {
    const layoutPath = relOfType(slidePart, T.layout);
    if (ctxCache.has(layoutPath)) return ctxCache.get(layoutPath);
    const layout = layoutPath ? await loadPart(layoutPath) : null;
    const masterPath = layout && relOfType(layout, T.master);
    const master = masterPath ? await loadPart(masterPath) : null;
    const themePath = master && relOfType(master, T.theme);
    const theme = themePath ? parse(await read(themePath)) : null;
    const clrMap = master ? first(master.doc, NS.p, 'clrMap') : null;
    const scheme = theme ? first(theme, NS.a, 'clrScheme') : null;
    const schemeHex = (name) => {
      const c = kid(scheme, NS.a, name);
      const v = c && kids(c, NS.a)[0];
      return v ? (v.getAttribute('lastClr') || v.getAttribute('val')) : null;
    };
    const fontOf = (el) => {
      if (!el) return null;
      const hang = kids(el, NS.a, 'font').find((f) => f.getAttribute('script') === 'Hang')?.getAttribute('typeface');
      return hang || kid(el, NS.a, 'ea')?.getAttribute('typeface') || kid(el, NS.a, 'latin')?.getAttribute('typeface') || null;
    };
    const ctx = {
      theme: (name) => schemeHex(clrMap?.getAttribute(name) || { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }[name] || name),
      fonts: { major: fontOf(first(theme, NS.a, 'majorFont')), minor: fontOf(first(theme, NS.a, 'minorFont')) },
      image: (partPath, rId) => {
        const p = parts.get(partPath) || slides.find((s) => s.path === partPath);
        const t = rId && p?.rels.get(rId)?.target;
        return t ? urls.get(t) || null : null;
      },
      layout: layout ? { doc: layout.doc, tree: spTreeOf(layout.doc), part: layout.path, name: first(layout.doc, NS.p, 'cSld')?.getAttribute('name') } : null,
      master: master ? { doc: master.doc, tree: spTreeOf(master.doc), part: master.path, txStyles: first(master.doc, NS.p, 'txStyles'), path: master.path } : null,
      defaultTextStyle,
    };
    ctxCache.set(layoutPath, ctx);
    return ctx;
  }

  const slides = [];
  for (const sldId of kids(sldIdLst, NS.p, 'sldId')) {
    const rid = sldId.getAttributeNS(NS.r, 'id');
    const path = resolvePath(presPath, presRelById.get(rid).getAttribute('Target'));
    const part = await loadPart(path);
    slides.push({ ...part, sldId, rid, ctx: await contextFor(part), deleted: false });
  }
  if (!slides.length) throw new Error('슬라이드가 없는 파일입니다');

  return { zip, read, parts, loadPart, relMap, relOfType, presPath, pres, presRels, presRelById, size, sldIdLst, urls, contextFor, slides };
}

export async function createPptxStudio(stage, toolbar, data) {
  const { zip, read, parts, loadPart, relMap, relOfType, presPath, pres, presRels, presRelById, size, sldIdLst, urls, contextFor, slides } = await openDeck(data);

  // ---------- 화면 뼈대 ----------
  const root = h('div', { class: 'pst' });
  const thumbs = h('div', { class: 'pst-thumbs' });
  const slideTools = h('div', { class: 'pst-slide-tools' });
  const viewport = h('div', { class: 'pst-view' });
  const scaler = h('div', { class: 'pst-scaler' });
  viewport.append(scaler);
  root.append(h('aside', { class: 'pst-side' }, slideTools, thumbs), viewport);
  stage.append(root);

  let cur = 0; // 지금 보는 슬라이드 (live 기준)
  let rendered = null; // { el, shapes }
  let sel = null; // 선택된 도형 XML 노드
  let editing = null; // { node, tx, before }
  let dirty = false;
  let scale = 1;
  const live = () => slides.filter((s) => !s.deleted);
  const slide = () => live()[cur];
  const markDirty = () => { dirty = true; scheduleThumb(); };

  // ---------- 되돌리기 ----------
  const undoStack = []; const redoStack = [];
  const snapshot = (s = slide()) => { undoStack.push({ s, xml: serialize(s.doc) }); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; };
  function restore(from, to) {
    const e = from.pop();
    if (!e) return;
    to.push({ s: e.s, xml: serialize(e.s.doc) });
    e.s.doc = parse(e.xml);
    sel = null;
    const i = live().indexOf(e.s);
    if (i >= 0) cur = i;
    dirty = true;
    renderAll();
  }
  const history = {
    undo: () => { if (editing) return false; restore(undoStack, redoStack); return true; },
    redo: () => { if (editing) return false; restore(redoStack, undoStack); return true; },
  };

  // ---------- 도구모음 ----------
  const stopBar = buildRichToolbar(toolbar, {
    focusTarget: () => editing?.tx || null,
    features: { size: true },
    detail: true,
    history,
    onChange: () => { if (editing) dirty = true; },
  });
  const imgInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addImage(f); } });
  const fillInput = h('input', { type: 'color', value: '#4472c4', title: '채우기 색', oninput: (e) => setFill(e.target.value) });
  const needSel = [];
  const tool = (title, ic, fn, needs = true) => {
    const b = h('button', { title, onclick: fn }, icon(ic));
    if (needs) needSel.push(b);
    return b;
  };
  const fillTool = h('label', { class: 'tb color-tool', title: '채우기 색' }, icon('fill'), fillInput);
  needSel.push(fillTool);
  toolbar.append(h('span', { class: 'sep' }),
    tool('글상자 넣기', 'text', () => addTextBox(), false),
    h('button', { title: '도형 넣기', onclick: (e) => { e.stopPropagation(); menu(e.currentTarget, SHAPES.map(([k, label]) => [label, () => addShape(k)])); } }, icon('shape')),
    h('label', { class: 'tb', title: '그림 넣기' }, icon('image'), imgInput),
    h('span', { class: 'sep' }),
    fillTool,
    tool('복제 (Ctrl+D)', 'copy', () => duplicateSel()),
    tool('앞으로 가져오기', 'front', () => reorder(1)),
    tool('뒤로 보내기', 'back', () => reorder(-1)),
    tool('삭제 (Delete)', 'trash', () => deleteSel()));
  const syncTools = () => { for (const b of needSel) b.classList.toggle('disabled', !sel); };

  // ---------- 그리기 ----------
  function fit() {
    const w = viewport.clientWidth - 24;
    const hgt = viewport.clientHeight - 24;
    const sw = px(size.cx); const sh = px(size.cy);
    scale = Math.max(0.1, window.innerWidth < 700 || hgt < 120 ? w / sw : Math.min(w / sw, hgt / sh));
    scaler.style.width = `${sw * scale}px`;
    scaler.style.height = `${sh * scale}px`;
    if (rendered) rendered.el.style.transform = `scale(${scale})`;
    scaler.style.setProperty('--hs', `${(window.innerWidth < 700 ? 18 : 12) / scale}px`);
    placeOverlay();
  }
  const ro = new ResizeObserver(() => fit());
  ro.observe(viewport);

  const overlay = h('div', { class: 'pst-sel' });
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  for (const d of HANDLES) overlay.append(h('i', { class: `hd hd-${d}`, 'data-dir': d }));

  function renderCurrent() {
    const s = slide();
    rendered = renderSlide(s, s.ctx, size);
    for (const { el } of rendered.shapes) {
      const tx = el.querySelector(':scope > .sl-text');
      if (tx && !tx.textContent.trim()) tx.classList.add('empty');
    }
    rendered.el.style.transform = `scale(${scale})`;
    rendered.el.append(overlay);
    scaler.replaceChildren(rendered.el);
    if (sel && !rendered.shapes.some((x) => x.node === sel)) sel = null;
    placeOverlay();
    syncTools();
  }
  function renderThumbs() {
    thumbs.replaceChildren(...live().map((s, i) => {
      const { el } = renderSlide(s, s.ctx, size);
      const tw = 132;
      el.style.transform = `scale(${tw / px(size.cx)})`;
      const holder = h('div', { class: 'pst-thumb-img', style: `width:${tw}px;height:${tw * size.cy / size.cx}px` }, el);
      return h('button', { class: `pst-thumb${i === cur ? ' on' : ''}`, onclick: () => go(i) }, h('span', {}, String(i + 1)), holder);
    }));
    thumbs.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  let thumbTimer;
  function scheduleThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const btn = thumbs.children[cur];
      const s = slide();
      if (!btn || !s) return renderThumbs();
      const { el } = renderSlide(s, s.ctx, size);
      el.style.transform = `scale(${132 / px(size.cx)})`;
      btn.querySelector('.pst-thumb-img').replaceChildren(el);
    }, 250);
  }
  function renderAll() { renderCurrent(); renderThumbs(); }
  function go(i) {
    commitEdit();
    cur = Math.max(0, Math.min(live().length - 1, i));
    sel = null;
    renderAll();
  }

  // 선택 테두리
  function boxOf(node) { return effectiveXfrm(node, slide().ctx); }
  function placeOverlay(box = sel && boxOf(sel)) {
    if (!sel || !box) { overlay.hidden = true; return; }
    overlay.hidden = false;
    overlay.classList.toggle('editing', !!editing);
    overlay.classList.toggle('line', sel.localName === 'cxnSp');
    Object.assign(overlay.style, { left: `${px(box.x)}px`, top: `${px(box.y)}px`, width: `${px(box.w)}px`, height: `${px(box.h)}px`, transform: box.rot ? `rotate(${box.rot}deg)` : '' });
  }
  function select(node) {
    if (editing && editing.node !== node) commitEdit();
    sel = node;
    placeOverlay();
    syncTools();
    const c = sel && first(kid(sel, NS.p, 'spPr'), NS.a, 'srgbClr');
    if (c) fillInput.value = `#${c.getAttribute('val').toLowerCase()}`;
  }
  const entryOf = (node) => rendered.shapes.find((x) => x.node === node);

  // ---------- 위치 쓰기 ----------
  function ensureSpPr(node) {
    let spPr = kid(node, NS.p, 'spPr');
    if (!spPr) {
      spPr = node.ownerDocument.createElementNS(NS.p, 'p:spPr');
      const nv = kids(node, NS.p).find((n) => /^nv/.test(n.localName));
      node.insertBefore(spPr, nv ? nv.nextSibling : node.firstChild);
    }
    return spPr;
  }
  function writeXfrm(node, b) {
    const doc = node.ownerDocument;
    let x = xfrmElOf(node);
    if (!x) {
      if (node.localName === 'graphicFrame') {
        x = doc.createElementNS(NS.p, 'p:xfrm');
        const nv = kid(node, NS.p, 'nvGraphicFramePr');
        node.insertBefore(x, nv ? nv.nextSibling : node.firstChild);
      } else {
        const holder = node.localName === 'grpSp' ? kid(node, NS.p, 'grpSpPr') : ensureSpPr(node);
        x = doc.createElementNS(NS.a, 'a:xfrm');
        holder.insertBefore(x, holder.firstChild);
      }
    }
    let off = kid(x, NS.a, 'off'); let ext = kid(x, NS.a, 'ext');
    if (!off) { off = doc.createElementNS(NS.a, 'a:off'); x.insertBefore(off, x.firstChild); }
    if (!ext) { ext = doc.createElementNS(NS.a, 'a:ext'); x.insertBefore(ext, off.nextSibling); }
    off.setAttribute('x', String(Math.round(b.x))); off.setAttribute('y', String(Math.round(b.y)));
    ext.setAttribute('cx', String(Math.max(0, Math.round(b.w)))); ext.setAttribute('cy', String(Math.max(0, Math.round(b.h))));
  }

  // ---------- 누르기·끌기 ----------
  let drag = null;
  const toEmu = (dpx) => (dpx / scale) * EMU_PX;
  function topShape(target) {
    let el = target.closest('.sl-shape');
    while (el && el.parentElement && el.parentElement !== rendered.el) el = el.parentElement.closest('.sl-shape');
    return el && !el.classList.contains('sl-deco') ? rendered.shapes.find((x) => x.el === el) : null;
  }
  function onDown(e) {
    if (e.button > 0) return;
    const handle = e.target.closest('.hd');
    if (editing && editing.tx.contains(e.target)) return; // 글자 고치는 중: 브라우저 기본 동작
    let entry = handle ? entryOf(sel) : topShape(e.target);
    if (!entry) { commitEdit(); select(null); return; }
    e.preventDefault();
    const wasSelected = sel === entry.node;
    if (!wasSelected) { select(entry.node); entry = entryOf(entry.node) || entry; }
    const start = boxOf(entry.node);
    if (!start) return;
    drag = { entry, start, dir: handle?.dataset.dir || null, x0: e.clientX, y0: e.clientY, moved: false, wasSelected, box: { ...start } };
    rendered.el.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x0; const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      if (editing) { commitEdit(); drag.entry = entryOf(drag.entry.node) || drag.entry; }
      snapshot();
    }
    const s = drag.start; const ex = toEmu(dx); const ey = toEmu(dy);
    const b = { ...s };
    if (!drag.dir) { b.x = s.x + ex; b.y = s.y + ey; } else {
      const d = drag.dir;
      if (d.includes('e')) b.w = s.w + ex;
      if (d.includes('s')) b.h = s.h + ey;
      if (d.includes('w')) { b.w = s.w - ex; b.x = s.x + ex; }
      if (d.includes('n')) { b.h = s.h - ey; b.y = s.y + ey; }
      // 그림은 모서리로 줄이면 비율 유지
      if (drag.entry.node.localName === 'pic' && d.length === 2 && s.w && s.h) {
        const r = s.w / s.h;
        const nh = b.w / r;
        if (d.includes('n')) b.y = s.y + s.h - nh;
        b.h = nh;
      }
      const min = EMU_PX * 8;
      if (b.w < min) { if (d.includes('w')) b.x -= min - b.w; b.w = min; }
      if (b.h < min && drag.entry.node.localName !== 'cxnSp') { if (d.includes('n')) b.y -= min - b.h; b.h = min; }
    }
    drag.box = b;
    const el = drag.entry.el;
    el.style.left = `${px(b.x)}px`; el.style.top = `${px(b.y)}px`; el.style.width = `${px(b.w)}px`; el.style.height = `${px(b.h)}px`;
    placeOverlay(b);
  }
  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      writeXfrm(d.entry.node, d.box);
      markDirty();
      renderCurrent();
      return;
    }
    // 이미 선택된 글자 상자를 한 번 더 누르면 글자 고치기
    if (d.wasSelected && !d.dir && ['sp'].includes(d.entry.node.localName)) startEdit(d.entry.node);
  }
  scaler.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  scaler.addEventListener('dblclick', (e) => { const entry = topShape(e.target); if (entry && entry.node.localName === 'sp') startEdit(entry.node); });
  viewport.addEventListener('pointerdown', (e) => { if (e.target === viewport) { commitEdit(); select(null); } });

  // ---------- 글자 고치기 ----------
  function ensureTxBody(node) {
    let tb = kid(node, NS.p, 'txBody');
    if (tb) return tb;
    snapshot();
    const doc = node.ownerDocument;
    tb = doc.createElementNS(NS.p, 'p:txBody');
    const bp = doc.createElementNS(NS.a, 'a:bodyPr');
    bp.setAttribute('rtlCol', '0'); bp.setAttribute('anchor', 'ctr');
    const p = doc.createElementNS(NS.a, 'a:p');
    const pPr = doc.createElementNS(NS.a, 'a:pPr'); pPr.setAttribute('algn', 'ctr');
    p.append(pPr);
    tb.append(bp, doc.createElementNS(NS.a, 'a:lstStyle'), p);
    node.append(tb);
    return tb;
  }
  function startEdit(node) {
    if (editing?.node === node) return;
    commitEdit();
    if (node.localName !== 'sp') return;
    const hadText = !!kid(node, NS.p, 'txBody');
    ensureTxBody(node);
    if (!hadText) renderCurrent();
    const entry = entryOf(node);
    const tx = entry?.el.querySelector(':scope > .sl-text');
    if (!tx) return;
    sel = node;
    tx.classList.remove('empty');
    tx.contentEditable = 'true';
    tx.spellcheck = false;
    editing = { node, tx, before: tx.innerHTML, snap: serialize(slide().doc) };
    entry.el.classList.add('is-editing');
    placeOverlay();
    tx.focus();
    const r = document.createRange();
    r.selectNodeContents(tx);
    if (tx.dataset.fresh) delete tx.dataset.fresh; else r.collapse(false);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function commitEdit() {
    if (!editing) return;
    const { node, tx, before, snap } = editing;
    editing = null;
    tx.contentEditable = 'false';
    if (tx.innerHTML !== before) {
      undoStack.push({ s: slide(), xml: snap }); redoStack.length = 0;
      const body = kid(node, NS.p, 'txBody');
      let blocks = [...tx.children].filter((el) => /^(P|DIV|H\d|LI)$/.test(el.tagName));
      if (!blocks.length) { const p = document.createElement('p'); p.innerHTML = tx.innerHTML; blocks = [p]; }
      const paras = kids(body, NS.a, 'p');
      if (!paras.length) { const p = body.ownerDocument.createElementNS(NS.a, 'a:p'); body.append(p); paras.push(p); }
      for (let i = 0; i < blocks.length; i++) {
        let p = paras[i];
        if (!p) { p = paras.at(-1).cloneNode(true); body.appendChild(p); paras.push(p); }
        writeParagraph(p, blocks[i]);
      }
      for (let i = blocks.length; i < paras.length; i++) paras[i].remove();
      markDirty();
    }
    renderCurrent();
  }

  // ---------- 넣기 ----------
  function nextId(doc) {
    let max = 1;
    for (const c of doc.getElementsByTagNameNS(NS.p, 'cNvPr')) max = Math.max(max, Number(c.getAttribute('id')) || 0);
    return max + 1;
  }
  function insertNode(xml) {
    const s = slide();
    snapshot(s);
    const tree = spTreeOf(s.doc);
    const frag = parse(`<root xmlns:a="${NS.a}" xmlns:p="${NS.p}" xmlns:r="${NS.r}">${xml}</root>`);
    const node = s.doc.importNode(frag.documentElement.firstElementChild, true);
    const extLst = kid(tree, NS.p, 'extLst');
    tree.insertBefore(node, extLst);
    markDirty();
    sel = node;
    renderCurrent();
    return node;
  }
  const xfrmXml = (b) => `<a:xfrm><a:off x="${Math.round(b.x)}" y="${Math.round(b.y)}"/><a:ext cx="${Math.round(b.w)}" cy="${Math.round(b.h)}"/></a:xfrm>`;
  function centerBox(wf, hf) { const w = size.cx * wf; const hh = size.cy * hf; return { x: (size.cx - w) / 2, y: (size.cy - hh) / 2, w, h: hh }; }

  function addTextBox() {
    commitEdit();
    const id = nextId(slide().doc);
    const node = insertNode(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(centerBox(0.5, 0.12))}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US" sz="2400" dirty="0"/><a:t>텍스트를 입력하세요</a:t></a:r></a:p></p:txBody></p:sp>`);
    const tx = entryOf(node)?.el.querySelector('.sl-text');
    if (tx) tx.dataset.fresh = '1';
    startEdit(node);
  }
  function addShape(prst) {
    commitEdit();
    const id = nextId(slide().doc);
    if (prst === 'line') {
      insertNode(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrmXml(centerBox(0.3, 0))}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`);
      return;
    }
    const sq = size.cy * 0.3;
    const b = { x: (size.cx - sq * 1.3) / 2, y: (size.cy - sq) / 2, w: sq * 1.3, h: sq };
    insertNode(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(b)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="2F528F"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="ko-KR" altLang="en-US" sz="1800" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:endParaRPr></a:p></p:txBody></p:sp>`);
  }
  async function addImage(file) {
    commitEdit();
    let bytes = await file.arrayBuffer();
    let ext = (file.type.split('/')[1] || '').replace('jpeg', 'jpg');
    let url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('그림을 읽지 못했습니다')); img.src = url; }).catch((e) => { toast(e.message); throw e; });
    if (!['png', 'jpg', 'gif'].includes(ext)) {
      // 파워포인트가 모르는 형식(webp 등)은 PNG 로 바꿔 넣음
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      bytes = await blob.arrayBuffer();
      ext = 'png';
      URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
    }
    let n = 1;
    while (zip.file(`ppt/media/co_image${n}.${ext}`)) n++;
    const mediaPath = `ppt/media/co_image${n}.${ext}`;
    zip.file(mediaPath, bytes);
    urls.set(mediaPath, url);
    newExts.add(ext);
    const s = slide();
    if (!s.relsDoc) s.relsDoc = parse(`<Relationships xmlns="${NS.rel}"/>`);
    let rn = 1;
    while (s.rels.has(`rId${rn}`)) rn++;
    const rid = `rId${rn}`;
    const rel = s.relsDoc.createElementNS(NS.rel, 'Relationship');
    rel.setAttribute('Id', rid); rel.setAttribute('Type', T.image); rel.setAttribute('Target', relTarget(s.path, mediaPath));
    s.relsDoc.documentElement.append(rel);
    s.rels.set(rid, { type: T.image, target: mediaPath });
    const maxW = size.cx * 0.6; const maxH = size.cy * 0.6;
    const k = Math.min(maxW / (img.naturalWidth * EMU_PX), maxH / (img.naturalHeight * EMU_PX), 1);
    const w = img.naturalWidth * EMU_PX * k; const hh = img.naturalHeight * EMU_PX * k;
    const id = nextId(s.doc);
    insertNode(`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml({ x: (size.cx - w) / 2, y: (size.cy - hh) / 2, w, h: hh })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
  }
  const newExts = new Set();

  // ---------- 선택한 도형 다루기 ----------
  function deleteSel() {
    if (!sel) return;
    commitEdit();
    snapshot();
    sel.remove();
    sel = null;
    markDirty();
    renderCurrent();
  }
  function duplicateSel() {
    if (!sel) return;
    commitEdit();
    snapshot();
    const copy = sel.cloneNode(true);
    let id = nextId(slide().doc);
    for (const c of copy.getElementsByTagNameNS(NS.p, 'cNvPr')) c.setAttribute('id', String(id++));
    sel.parentNode.insertBefore(copy, sel.nextSibling);
    const b = boxOf(sel);
    if (b) writeXfrm(copy, { ...b, x: b.x + size.cx * 0.02, y: b.y + size.cy * 0.03 });
    sel = copy;
    markDirty();
    renderCurrent();
  }
  function reorder(d) {
    if (!sel) return;
    commitEdit();
    const siblings = kids(sel.parentNode, NS.p).filter((n) => SHAPE_TAGS.includes(n.localName));
    const i = siblings.indexOf(sel);
    const j = i + d;
    if (j < 0 || j >= siblings.length) return toast(d > 0 ? '이미 맨 앞입니다' : '이미 맨 뒤입니다');
    snapshot();
    if (d > 0) sel.parentNode.insertBefore(sel, siblings[j].nextSibling);
    else sel.parentNode.insertBefore(sel, siblings[j]);
    markDirty();
    renderCurrent();
  }
  function setFill(color) {
    if (!sel || !['sp'].includes(sel.localName)) return toast('도형이나 글상자를 먼저 고르세요');
    if (!fillTimer) snapshot();
    clearTimeout(fillTimer);
    fillTimer = setTimeout(() => { fillTimer = null; }, 600);
    const doc = sel.ownerDocument;
    const spPr = ensureSpPr(sel);
    for (const n of kids(spPr, NS.a)) if (['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'].includes(n.localName)) n.remove();
    const fill = doc.createElementNS(NS.a, 'a:solidFill');
    const c = doc.createElementNS(NS.a, 'a:srgbClr');
    c.setAttribute('val', color.slice(1).toUpperCase());
    fill.append(c);
    const after = kids(spPr, NS.a).find((n) => ['prstGeom', 'custGeom'].includes(n.localName)) || kid(spPr, NS.a, 'xfrm');
    spPr.insertBefore(fill, after ? after.nextSibling : spPr.firstChild);
    markDirty();
    renderCurrent();
  }
  let fillTimer = null;

  // ---------- 슬라이드 다루기 ----------
  const SLIDE_SHELL = (inner) => `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  function freeSlidePath() {
    let n = 1;
    while (zip.file(`ppt/slides/slide${n}.xml`) || slides.some((s) => s.path === `ppt/slides/slide${n}.xml`)) n++;
    return `ppt/slides/slide${n}.xml`;
  }
  function layoutsOfMaster() {
    const m = slide().ctx.master;
    const master = m && parts.get(m.path);
    if (!master) return [];
    return [...master.rels.values()].filter((r) => r.type === T.layout).map((r) => r.target);
  }
  async function newSlide(layoutPath) {
    commitEdit();
    const layout = await loadPart(layoutPath);
    let id = 2;
    let inner = '';
    for (const sp of kids(spTreeOf(layout.doc), NS.p, 'sp')) {
      const ph = phOf(sp);
      if (!ph || ['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type)) continue;
      const phXml = `<p:ph${ph.type !== 'body' || !ph.idx ? ` type="${ph.type}"` : ''}${ph.idx != null ? ` idx="${ph.idx}"` : ''}/>`;
      inner += `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Placeholder ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/></a:p></p:txBody></p:sp>`;
      id++;
    }
    const path = freeSlidePath();
    const relsDoc = parse(`<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${T.layout}" Target="${relTarget(path, layoutPath)}"/></Relationships>`);
    const part = { path, doc: parse(SLIDE_SHELL(inner)), relsDoc, rels: relMap(path, relsDoc) };
    insertSlide({ ...part, sldId: null, rid: null, ctx: await contextFor(part), deleted: false });
  }
  async function duplicateSlide() {
    commitEdit();
    const base = slide();
    const path = freeSlidePath();
    const doc = parse(serialize(base.doc));
    let relsDoc = null;
    if (base.relsDoc) {
      relsDoc = parse(serialize(base.relsDoc));
      for (const r of [...relsDoc.getElementsByTagNameNS(NS.rel, 'Relationship')]) {
        if (r.getAttribute('Type') === T.notes) { r.remove(); continue; }
        // 같은 폴더에 만드므로 상대 경로는 그대로 유효
      }
    }
    insertSlide({ path, doc, relsDoc, rels: relMap(path, relsDoc), sldId: null, rid: null, ctx: base.ctx, deleted: false });
  }
  function insertSlide(s) {
    const at = slides.indexOf(slide()) + 1;
    slides.splice(at, 0, s);
    cur = live().indexOf(s);
    sel = null;
    dirty = true;
    renderAll();
  }
  function deleteSlide() {
    if (live().length <= 1) return toast('마지막 슬라이드는 지울 수 없습니다');
    if (!confirm('이 슬라이드를 지울까요? (저장하기 전까지 원본 파일은 그대로입니다)')) return;
    commitEdit();
    slide().deleted = true;
    cur = Math.min(cur, live().length - 1);
    sel = null;
    dirty = true;
    renderAll();
  }
  function moveSlide(d) {
    commitEdit();
    const l = live();
    const j = cur + d;
    if (j < 0 || j >= l.length) return;
    const a = slides.indexOf(l[cur]); const b = slides.indexOf(l[j]);
    [slides[a], slides[b]] = [slides[b], slides[a]];
    cur = j;
    dirty = true;
    renderAll();
  }
  slideTools.append(
    h('button', { title: '새 슬라이드', onclick: (e) => {
      e.stopPropagation();
      const anchor = e.currentTarget;
      const items = layoutsOfMaster().map((p) => [parts.get(p) ? (first(parts.get(p).doc, NS.p, 'cSld')?.getAttribute('name') || p.split('/').pop()) : p.split('/').pop(), () => newSlide(p)]);
      if (items.length <= 1) return newSlide(items.length ? layoutsOfMaster()[0] : relOfType(slide(), T.layout));
      menu(anchor, items);
    } }, icon('plus'), h('span', {}, '새 슬라이드')),
    h('button', { title: '슬라이드 복제', onclick: () => duplicateSlide() }, icon('copy')),
    h('button', { title: '위로', onclick: () => moveSlide(-1) }, '↑'),
    h('button', { title: '아래로', onclick: () => moveSlide(1) }, '↓'),
    h('button', { title: '슬라이드 삭제', class: 'danger', onclick: () => deleteSlide() }, icon('trash')));
  // 레이아웃 이름을 메뉴에 보이려고 미리 읽어 둠
  await Promise.all(layoutsOfMaster().map((p) => loadPart(p).catch(() => null)));

  // ---------- 키보드 ----------
  function onKey(e) {
    if (!root.isConnected) return;
    const t = e.target;
    if (editing) { if (e.key === 'Escape') { e.preventDefault(); commitEdit(); } return; }
    if (t.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); history.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); history.redo(); return; }
    if (e.key === 'PageDown') { e.preventDefault(); go(cur + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); go(cur - 1); return; }
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(sel); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const b = boxOf(sel);
      if (!b) return;
      const step = EMU_PX * (e.shiftKey ? 10 : 1);
      snapshot();
      writeXfrm(sel, { ...b, x: b.x + arrows[e.key][0] * step, y: b.y + arrows[e.key][1] * step });
      markDirty();
      renderCurrent();
    }
  }
  document.addEventListener('keydown', onKey);

  renderAll();
  fit();

  // ---------- 저장 ----------
  async function toBlob() {
    commitEdit();
    const ct = parse(await read('[Content_Types].xml'));
    const ctRoot = ct.documentElement;
    const hasOverride = (part) => [...ct.getElementsByTagNameNS(NS.ct, 'Override')].some((o) => o.getAttribute('PartName') === `/${part}`);
    for (const ext of newExts) {
      if (![...ct.getElementsByTagNameNS(NS.ct, 'Default')].some((d) => d.getAttribute('Extension').toLowerCase() === ext)) {
        const d = ct.createElementNS(NS.ct, 'Default');
        d.setAttribute('Extension', ext); d.setAttribute('ContentType', IMG_CT[ext]);
        ctRoot.insertBefore(d, ctRoot.firstChild);
      }
    }
    // 지운 슬라이드 정리 (이미 파일에 있던 것만)
    for (const s of slides.filter((x) => x.deleted)) {
      if (!s.rid) continue;
      presRelById.get(s.rid)?.remove();
      presRelById.delete(s.rid);
      const remove = [s.path];
      for (const r of s.rels.values()) if (r.type === T.notes && r.target) remove.push(r.target);
      for (const part of remove) {
        zip.remove(part); zip.remove(relsPathOf(part));
        for (const o of [...ct.getElementsByTagNameNS(NS.ct, 'Override')]) if (o.getAttribute('PartName') === `/${part}`) o.remove();
      }
    }
    for (let i = slides.length - 1; i >= 0; i--) if (slides[i].deleted) slides.splice(i, 1);
    // 남은 슬라이드 쓰기 + 순서
    for (const el of kids(sldIdLst, NS.p, 'sldId')) el.remove();
    let maxId = 255;
    for (const s of slides) if (s.sldId) maxId = Math.max(maxId, Number(s.sldId.getAttribute('id')));
    for (const s of slides) {
      if (!s.rid) {
        let rn = 1;
        while (presRelById.has(`rId${rn}`)) rn++;
        s.rid = `rId${rn}`;
        const rel = presRels.createElementNS(NS.rel, 'Relationship');
        rel.setAttribute('Id', s.rid); rel.setAttribute('Type', T.slide); rel.setAttribute('Target', relTarget(presPath, s.path));
        presRels.documentElement.append(rel);
        presRelById.set(s.rid, rel);
        s.sldId = pres.createElementNS(NS.p, 'p:sldId');
        s.sldId.setAttribute('id', String(++maxId));
        s.sldId.setAttributeNS(NS.r, 'r:id', s.rid);
      }
      if (!hasOverride(s.path)) {
        const o = ct.createElementNS(NS.ct, 'Override');
        o.setAttribute('PartName', `/${s.path}`); o.setAttribute('ContentType', SLIDE_CT);
        ctRoot.append(o);
      }
      sldIdLst.append(s.sldId);
      zip.file(s.path, serialize(s.doc));
      if (s.relsDoc) zip.file(relsPathOf(s.path), serialize(s.relsDoc));
    }
    zip.file(presPath, serialize(pres));
    zip.file(relsPathOf(presPath), serialize(presRels));
    zip.file('[Content_Types].xml', serialize(ct));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
  }

  return {
    page: root,
    get dirty() { return dirty || !!(editing && editing.tx.innerHTML !== editing.before); },
    markSaved() { dirty = false; },
    toBlob,
    destroy() {
      stopBar();
      ro.disconnect();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      clearTimeout(thumbTimer);
      for (const u of urls.values()) URL.revokeObjectURL(u);
    },
  };
}
