// 파워포인트(PPTX) 간단 편집: 슬라이드 글자 고치기, 순서 바꾸기, 지우기
// 디자인(배경·도형 위치·글꼴)은 원본 파일 그대로 두고, 글자 부분만 바꿔 저장한다.
import { h, toast } from './ui.js';

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

// 문단 하나의 글자를 바꿈: 첫 글자 덩어리의 서식은 유지하고 나머지는 지움
function setParagraphText(p, text) {
  const runs = [...p.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === NS.a && ['r', 'br', 'fld'].includes(n.localName));
  const keep = runs.find((n) => n.localName === 'r');
  runs.forEach((n) => { if (n !== keep) n.remove(); });
  if (!text) { keep?.remove(); return; }
  let run = keep;
  if (!run) {
    const doc = p.ownerDocument;
    run = doc.createElementNS(NS.a, 'a:r');
    const end = kids(p, NS.a, 'endParaRPr')[0];
    if (end) {
      const rPr = doc.createElementNS(NS.a, 'a:rPr');
      for (const at of end.attributes) rPr.setAttribute(at.name, at.value);
      for (const c of end.childNodes) rPr.appendChild(c.cloneNode(true));
      run.appendChild(rPr);
    }
    run.appendChild(doc.createElementNS(NS.a, 'a:t'));
    p.insertBefore(run, end || null);
  }
  first(run, NS.a, 't').textContent = text;
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

export async function createPptxEditor(stage, toolbar, data) {
  const JSZip = (await import('jszip')).default;
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
      boxes.push({ body, paras, label: PH_LABEL[phType] || `글자 상자 ${n}`, original: paras.map(paragraphText).join('\n') });
    }
    slides.push({ sldId, rid, path, doc, boxes, deleted: false });
  }

  // ---------- 화면 ----------
  let dirty = false;
  const list = h('div', { class: 'pptx-edit' });
  stage.append(list);
  toolbar.append(h('span', { class: 'tb-note' }, '글자만 고칩니다 · 디자인은 원본 그대로'));
  toolbar.hidden = false;

  const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  function render() {
    const live = slides.filter((s) => !s.deleted);
    list.replaceChildren(...live.map((s, i) => h('section', { class: 'slide-card' },
      h('div', { class: 'slide-head' },
        h('b', {}, `슬라이드 ${i + 1}`),
        h('div', { class: 'slide-tools' },
          h('button', { title: '위로', disabled: i === 0, onclick: () => move(s, -1) }, '↑'),
          h('button', { title: '아래로', disabled: i === live.length - 1, onclick: () => move(s, 1) }, '↓'),
          h('button', { title: '슬라이드 삭제', class: 'danger', onclick: () => remove(s) }, '삭제'))),
      s.boxes.length ? s.boxes.map((b) => {
        const ta = h('textarea', { rows: 1, oninput: (e) => { b.value = e.target.value; dirty = true; autoGrow(e.target); } });
        ta.value = b.value ?? b.original;
        requestAnimationFrame(() => autoGrow(ta));
        return h('label', { class: 'box' }, h('span', {}, b.label), ta);
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
    // 1) 글자 반영
    for (const s of slides) {
      if (s.deleted) continue;
      let changed = false;
      for (const b of s.boxes) {
        if (b.value === undefined || b.value === b.original) continue;
        changed = true;
        const lines = b.value.split('\n');
        const paras = kids(b.body, NS.a, 'p');
        for (let i = 0; i < lines.length; i++) {
          let p = paras[i];
          if (!p) { p = paras.at(-1).cloneNode(true); b.body.appendChild(p); paras.push(p); }
          setParagraphText(p, lines[i]);
        }
        for (let i = lines.length; i < paras.length; i++) paras[i].remove();
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
    markSaved() { dirty = false; for (const s of slides) for (const b of s.boxes) if (b.value !== undefined) b.original = b.value; },
    toBlob,
    destroy() {},
  };
}
