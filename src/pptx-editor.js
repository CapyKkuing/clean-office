// 파워포인트(PPTX) 간단 편집: 슬라이드 글자 고치기, 순서 바꾸기, 지우기
// 디자인(배경·도형 위치·글꼴)은 원본 파일 그대로 두고, 글자 부분만 바꿔 저장한다.
import { h, toast, icon } from './ui.js';
import { buildRichToolbar, paragraphRuns, blockAlign, runsToHtml } from './rich-toolbar.js';
import { cleanHtml, setPurifier } from './pptx-render.js';

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PH_LABEL = { title: '제목', ctrTitle: '제목', subTitle: '부제목', body: '본문', dt: '날짜', ftr: '바닥글', sldNum: '쪽 번호' };

const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
const serialize = (doc) => XML_HEAD + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
const kids = (el, ns, name) => [...el.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === ns && n.localName === name);
const first = (el, ns, name) => el.getElementsByTagNameNS(ns, name)[0] || null;

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
const relsPathOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');

function paragraphText(p) {
  let s = '';
  for (const n of p.childNodes) {
    if (n.nodeType !== 1 || n.namespaceURI !== NS.a) continue;
    if (n.localName === 'r' || n.localName === 'fld') s += first(n, NS.a, 't')?.textContent ?? '';
    else if (n.localName === 'br') s += ' ';
  }
  return s;
}

const ALGN_CSS = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
const CSS_ALGN = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };

// 슬라이드 문단(a:p) → 편집 화면 HTML <p>
function paraToHtml(p) {
  const runs = [];
  for (const n of p.childNodes) {
    if (n.nodeType !== 1 || n.namespaceURI !== NS.a) continue;
    if (n.localName === 'br') { runs.push({ text: ' ' }); continue; }
    if (n.localName !== 'r' && n.localName !== 'fld') continue;
    const rPr = kids(n, NS.a, 'rPr')[0];
    const clr = rPr && first(rPr, NS.a, 'srgbClr');
    runs.push({
      text: first(n, NS.a, 't')?.textContent ?? '',
      bold: rPr?.getAttribute('b') === '1',
      italic: rPr?.getAttribute('i') === '1',
      underline: !!rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none',
      color: clr && /^[0-9A-Fa-f]{6}$/.test(clr.getAttribute('val') || '') ? `#${clr.getAttribute('val').toLowerCase()}` : null,
    });
  }
  const algn = kids(p, NS.a, 'pPr')[0]?.getAttribute('algn');
  const style = algn && ALGN_CSS[algn] ? ` style="text-align:${ALGN_CSS[algn]}"` : '';
  return `<p${style}>${runsToHtml(runs.filter((r) => r.text))}</p>`;
}

// 편집한 <p> → 슬라이드 문단(a:p). 첫 글자 덩어리의 서식(글꼴·크기 등)을 바탕으로 굵게·기울임·밑줄·색만 바꿈
export function writeParagraph(p, block) {
  const doc = p.ownerDocument;
  const old = [...p.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === NS.a && ['r', 'br', 'fld'].includes(n.localName));
  const end = kids(p, NS.a, 'endParaRPr')[0];
  const firstRun = old.find((n) => n.localName === 'r');
  const baseRPr = firstRun ? kids(firstRun, NS.a, 'rPr')[0] : null;
  old.forEach((n) => n.remove());
  for (const r of paragraphRuns(block)) {
    const run = doc.createElementNS(NS.a, 'a:r');
    let rPr;
    if (baseRPr) rPr = baseRPr.cloneNode(true);
    else {
      rPr = doc.createElementNS(NS.a, 'a:rPr');
      if (end) { for (const at of end.attributes) rPr.setAttribute(at.name, at.value); for (const c of end.childNodes) rPr.appendChild(c.cloneNode(true)); }
    }
    r.bold ? rPr.setAttribute('b', '1') : rPr.removeAttribute('b');
    r.italic ? rPr.setAttribute('i', '1') : rPr.removeAttribute('i');
    r.underline ? rPr.setAttribute('u', 'sng') : rPr.removeAttribute('u');
    if (r.size) rPr.setAttribute('sz', String(Math.round(r.size * 100)));
    if (r.color) {
      for (const f of [...rPr.childNodes]) if (f.nodeType === 1 && ['solidFill', 'gradFill', 'noFill'].includes(f.localName)) f.remove();
      const fill = doc.createElementNS(NS.a, 'a:solidFill');
      const clr = doc.createElementNS(NS.a, 'a:srgbClr');
      clr.setAttribute('val', r.color.slice(1).toUpperCase());
      fill.appendChild(clr);
      // a:solidFill 은 a:ln 다음, 글꼴(latin/ea/cs) 앞에 와야 함
      const before = [...rPr.childNodes].find((c) => c.nodeType === 1 && !['ln'].includes(c.localName));
      rPr.insertBefore(fill, before || null);
    }
    run.appendChild(rPr);
    const t = doc.createElementNS(NS.a, 'a:t');
    t.textContent = r.text;
    run.appendChild(t);
    p.insertBefore(run, end || null);
  }
  const align = blockAlign(block);
  if (align) {
    let pPr = kids(p, NS.a, 'pPr')[0];
    if (!pPr) { pPr = doc.createElementNS(NS.a, 'a:pPr'); p.insertBefore(pPr, p.firstChild); }
    pPr.setAttribute('algn', CSS_ALGN[align] || 'l');
  }
}

// 보기용: 슬라이드 순서대로 글자 상자 내용만 꺼냄
export async function readPptxText(data) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data.slice(0));
  const presPath = 'ppt/presentation.xml';
  const pres = parse(await zip.file(presPath).async('string'));
  const rels = parse(await zip.file(relsPathOf(presPath)).async('string'));
  const relById = new Map([...rels.getElementsByTagNameNS(NS.rel, 'Relationship')].map((r) => [r.getAttribute('Id'), r]));
  const out = [];
  for (const sldId of kids(first(pres, NS.p, 'sldIdLst'), NS.p, 'sldId')) {
    const path = resolvePath(presPath, relById.get(sldId.getAttributeNS(NS.r, 'id')).getAttribute('Target'));
    const doc = parse(await zip.file(path).async('string'));
    const texts = [];
    for (const body of doc.getElementsByTagNameNS(NS.p, 'txBody')) {
      for (const p of kids(body, NS.a, 'p')) { const t = paragraphText(p).trim(); if (t) texts.push(t); }
    }
    out.push(texts);
  }
  return out;
}

// 원래 글자색이 편집 화면 배경과 비슷하면 안 보임 → 글자색에 맞춰 상자 바탕을 밝게/어둡게 바꿈 (파일에는 영향 없음)
function luminance(color) {
  const m = color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const hexToRgb = (hx) => { const v = hx.slice(1); const f = v.length === 3 ? [...v].map((x) => x + x).join('') : v; return `rgb(${parseInt(f.slice(0, 2), 16)},${parseInt(f.slice(2, 4), 16)},${parseInt(f.slice(4, 6), 16)})`; };
function fitContrast(el) {
  const lums = [...el.querySelectorAll('[style*="color"], font[color]')]
    .filter((n) => n.textContent.trim())
    .map((n) => { const c = n.style?.color || n.getAttribute('color') || ''; return luminance(c.startsWith('#') ? hexToRgb(c) : c); })
    .filter((v) => v !== null);
  const dark = lums.filter((v) => v < 0.4).length;
  const light = lums.length - dark;
  el.classList.toggle('paper-light', dark > 0 && dark >= light);
  el.classList.toggle('paper-dark', light > dark);
}

export async function createPptxEditor(stage, toolbar, data, { detail = false } = {}) {
  const [JSZip, DOMPurify] = await Promise.all([import('jszip').then((m) => m.default), import('dompurify').then((m) => m.default)]);
  setPurifier(DOMPurify);
  const zip = await JSZip.loadAsync(data);
  const read = async (path) => { const f = zip.file(path); if (!f) throw new Error(`파일 구성요소가 없습니다: ${path}`); return f.async('string'); };

  const presPath = 'ppt/presentation.xml';
  const pres = parse(await read(presPath));
  const presRels = parse(await read(relsPathOf(presPath)));
  const relById = new Map([...presRels.getElementsByTagNameNS(NS.rel, 'Relationship')].map((r) => [r.getAttribute('Id'), r]));
  const sldIdLst = first(pres, NS.p, 'sldIdLst');
  if (!sldIdLst) throw new Error('슬라이드가 없는 파일입니다');

  // 슬라이드마다: 글자 상자 목록
  const slides = [];
  for (const sldId of kids(sldIdLst, NS.p, 'sldId')) {
    const rid = sldId.getAttributeNS(NS.r, 'id');
    const path = resolvePath(presPath, relById.get(rid).getAttribute('Target'));
    const doc = parse(await read(path));
    const boxes = [];
    let n = 0;
    for (const sp of doc.getElementsByTagNameNS(NS.p, 'sp')) {
      const body = kids(sp, NS.p, 'txBody')[0];
      if (!body) continue;
      const ph = first(sp, NS.p, 'ph');
      const phType = ph ? (ph.getAttribute('type') || 'body') : null;
      if (['dt', 'ftr', 'sldNum'].includes(phType)) continue;
      const paras = kids(body, NS.a, 'p');
      n += 1;
      const html = cleanHtml(paras.map(paraToHtml).join(''));
      boxes.push({ body, label: PH_LABEL[phType] || `글자 상자 ${n}`, html, current: html });
    }
    slides.push({ sldId, rid, path, doc, boxes, deleted: false });
  }

  // ---------- 화면 ----------
  let dirty = false;
  let lastBox = null;
  const list = h('div', { class: 'pptx-edit' });
  stage.append(list);
  const stopBar = buildRichToolbar(toolbar, { focusTarget: () => lastBox || list.querySelector('.box-edit'), features: {}, detail: false, onChange: () => (dirty = true) });
  if (detail) {
    toolbar.append(h('span', { class: 'sep' }),
      h('button', { title: '마지막 슬라이드를 복제해 뒤에 추가', onclick: () => addSlide() }, icon('plus'), h('span', {}, '슬라이드 추가')));
  }

  // 새 슬라이드: 마지막(지워지지 않은) 슬라이드를 복제. 디자인·배치가 같은 새 장을 만들고 글자만 바꿔 쓰게 함
  let newIndex = 0;
  async function addSlide() {
    const live = slides.filter((s) => !s.deleted);
    const base = live.at(-1);
    newIndex += 1;
    let n = 1;
    while (zip.file(`ppt/slides/slide${n}.xml`) || slides.some((s) => s.path === `ppt/slides/slide${n}.xml`)) n++;
    const path = `ppt/slides/slide${n}.xml`;
    const doc = parse(new XMLSerializer().serializeToString(base.doc));
    // 원본 슬라이드의 연결(레이아웃·그림)은 그대로, 발표자 노트 연결만 뺌
    const baseRels = zip.file(relsPathOf(base.path));
    if (baseRels) {
      const r = parse(await baseRels.async('string'));
      for (const rel of [...r.getElementsByTagNameNS(NS.rel, 'Relationship')]) if (/notesSlide$/.test(rel.getAttribute('Type'))) rel.remove();
      zip.file(relsPathOf(path), serialize(r));
    }
    const ct = parse(await read('[Content_Types].xml'));
    const ov = ct.createElementNS(NS.ct, 'Override');
    ov.setAttribute('PartName', `/${path}`);
    ov.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    ct.documentElement.appendChild(ov);
    zip.file('[Content_Types].xml', serialize(ct));
    let rn = 1;
    while (relById.has(`rId${rn}`)) rn++;
    const rid = `rId${rn}`;
    const rel = presRels.createElementNS(NS.rel, 'Relationship');
    rel.setAttribute('Id', rid);
    rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide');
    rel.setAttribute('Target', `slides/slide${n}.xml`);
    presRels.documentElement.appendChild(rel);
    relById.set(rid, rel);
    const ids = kids(sldIdLst, NS.p, 'sldId').map((e) => Number(e.getAttribute('id'))).concat(slides.map((s) => Number(s.sldId.getAttribute('id'))));
    const sldId = pres.createElementNS(NS.p, 'p:sldId');
    sldId.setAttribute('id', String(Math.max(255, ...ids) + 1));
    sldId.setAttributeNS(NS.r, 'r:id', rid);
    const boxes = [];
    let k = 0;
    for (const sp of doc.getElementsByTagNameNS(NS.p, 'sp')) {
      const body = kids(sp, NS.p, 'txBody')[0];
      if (!body) continue;
      const ph = first(sp, NS.p, 'ph');
      const phType = ph ? (ph.getAttribute('type') || 'body') : null;
      if (['dt', 'ftr', 'sldNum'].includes(phType)) continue;
      k += 1;
      const paras = kids(body, NS.a, 'p');
      // 복제한 장은 글자를 비워 둠 (원본 글자는 회색 안내로)
      boxes.push({ body, label: PH_LABEL[phType] || `글자 상자 ${k}`, html: '\u0000', current: '<p><br></p>', hint: paras.map(paragraphText).join(' / ') });
    }
    zip.file(path, serialize(doc));
    capture();
    slides.push({ sldId, rid, path, doc, boxes, deleted: false, added: true });
    dirty = true;
    render();
    list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('슬라이드를 추가했습니다. 글자를 입력하세요');
  }

  // 화면을 다시 그리기 전, 편집 중인 내용을 상자 정보에 옮겨 둠
  function capture() {
    for (const s of slides) for (const b of s.boxes) if (b.el) b.current = b.el.innerHTML;
  }
  function render() {
    capture();
    const live = slides.filter((s) => !s.deleted);
    list.replaceChildren(...live.map((s, i) => h('section', { class: 'slide-card' },
      h('div', { class: 'slide-head' },
        h('b', {}, `슬라이드 ${i + 1}`),
        detail ? h('div', { class: 'slide-tools' },
          h('button', { title: '위로', disabled: i === 0, onclick: () => move(s, -1) }, '↑'),
          h('button', { title: '아래로', disabled: i === live.length - 1, onclick: () => move(s, 1) }, '↓'),
          h('button', { title: '슬라이드 삭제', class: 'danger', onclick: () => remove(s) }, '삭제')) : null),
      s.boxes.length ? s.boxes.map((b) => {
        const el = h('div', { class: 'box-edit', contenteditable: 'true', spellcheck: 'false', 'data-hint': b.hint || '', onfocus: () => { lastBox = el; }, oninput: () => { dirty = true; fitContrast(el); } });
        el.innerHTML = b.current;
        fitContrast(el);
        b.el = el;
        return h('div', { class: 'box' }, h('span', {}, b.label), el);
      }) : h('p', { class: 'empty' }, '고칠 수 있는 글자 상자가 없습니다 (그림·표만 있는 슬라이드)'))));
  }
  function move(s, d) {
    const live = slides.filter((x) => !x.deleted);
    const i = live.indexOf(s);
    const j = i + d;
    if (j < 0 || j >= live.length) return;
    const a = slides.indexOf(live[i]);
    const b = slides.indexOf(live[j]);
    [slides[a], slides[b]] = [slides[b], slides[a]];
    dirty = true;
    render();
  }
  function remove(s) {
    if (slides.filter((x) => !x.deleted).length <= 1) return toast('마지막 슬라이드는 지울 수 없습니다');
    if (!confirm('이 슬라이드를 지울까요? (저장하기 전까지 원본 파일은 그대로입니다)')) return;
    s.deleted = true;
    dirty = true;
    render();
  }
  render();

  // ---------- 저장 ----------
  async function toBlob() {
    capture();
    // 1) 글자·서식 반영: 바뀐 상자만, 화면의 <p> 개수에 맞춰 문단을 늘리거나 줄임
    for (const s of slides) {
      if (s.deleted) continue;
      let changed = false;
      for (const b of s.boxes) {
        if (b.current === b.html) continue;
        changed = true;
        const tmp = document.createElement('div');
        tmp.innerHTML = b.current;
        let blocks = [...tmp.children].filter((el) => /^(P|DIV|H\d|LI)$/.test(el.tagName));
        if (!blocks.length) { const p = document.createElement('p'); p.innerHTML = b.current; blocks = [p]; }
        const paras = kids(b.body, NS.a, 'p');
        for (let i = 0; i < blocks.length; i++) {
          let p = paras[i];
          if (!p) { p = paras.at(-1).cloneNode(true); b.body.appendChild(p); paras.push(p); }
          writeParagraph(p, blocks[i]);
        }
        for (let i = blocks.length; i < paras.length; i++) paras[i].remove();
      }
      if (changed) zip.file(s.path, serialize(s.doc));
    }
    // 2) 순서·삭제 반영
    const ct = parse(await read('[Content_Types].xml'));
    for (const el of kids(sldIdLst, NS.p, 'sldId')) el.remove();
    for (const s of slides) {
      if (!s.deleted) { sldIdLst.appendChild(s.sldId); continue; }
      relById.get(s.rid)?.remove();
      const removeParts = [s.path];
      const sRels = zip.file(relsPathOf(s.path));
      if (sRels) {
        const r = parse(await sRels.async('string'));
        for (const rel of r.getElementsByTagNameNS(NS.rel, 'Relationship')) {
          if (/notesSlide$/.test(rel.getAttribute('Type'))) removeParts.push(resolvePath(s.path, rel.getAttribute('Target')));
        }
      }
      for (const part of removeParts) {
        zip.remove(part);
        zip.remove(relsPathOf(part));
        for (const o of [...ct.getElementsByTagNameNS(NS.ct, 'Override')]) if (o.getAttribute('PartName') === `/${part}`) o.remove();
      }
    }
    zip.file(presPath, serialize(pres));
    zip.file(relsPathOf(presPath), serialize(presRels));
    zip.file('[Content_Types].xml', serialize(ct));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
  }

  return {
    page: list,
    get dirty() { return dirty; },
    markSaved() { dirty = false; capture(); for (const s of slides) for (const b of s.boxes) b.html = b.current; },
    toBlob,
    destroy() { stopBar(); },
  };
}
