// 한글(HWP/HWPX) 간단 편집: 문단 글자·굵게/기울임/밑줄·글자색·정렬을 바로 고침
// 표·그림이 든 문단은 그대로 두고(상세 편집에서 고침), 고친 문단만 한글 엔진에 반영해 저장한다.
import { h, toast } from './ui.js';
import { loadRhwp } from './viewers.js';
import { buildRichToolbar, paragraphRuns, blockAlign, runsToHtml, escHtml } from './rich-toolbar.js';

const ALIGN_TO_CSS = { left: 'left', center: 'center', right: 'right', justify: 'justify', distribute: 'justify' };

export async function createHwpSimpleEditor(stage, toolbar, data, name) {
  const { HwpDocument } = await loadRhwp();
  const doc = new HwpDocument(new Uint8Array(data));
  const page = h('div', { class: 'editor-page hwp-simple', contenteditable: 'true', spellcheck: 'false' });

  const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const isObjectPara = (s, p) => {
    const ctls = json(doc.getControlTextPositions(s, p)) || [];
    return ctls.some((_, j) => {
      try { doc.getTableDimensions(s, p, j); return true; } catch { /* 표 아님 */ }
      try { doc.getControlImageMime(s, p, '[]', j); return true; } catch { /* 그림 아님 */ }
      return false;
    });
  };

  // ---------- 불러오기: 문단 → 편집 화면 ----------
  const original = new Map(); // "s:p" → 처음 HTML
  const blocks = [];
  for (let s = 0; s < doc.getSectionCount(); s++) {
    const n = doc.getParagraphCount(s);
    for (let p = 0; p < n; p++) {
      const len = doc.getParagraphLength(s, p);
      const key = `${s}:${p}`;
      if (isObjectPara(s, p)) {
        blocks.push(`<div class="hwp-obj" contenteditable="false" data-s="${s}" data-p="${p}">표·그림 — '상세 편집'에서 고칠 수 있어요</div>`);
        continue;
      }
      const text = len ? doc.getTextRange(s, p, 0, len) : '';
      const runs = [];
      for (const r of json(doc.getCharShapeRuns(s, p, 0, len)) || []) {
        const props = json(doc.getCharPropertiesAt(s, p, Math.min(r.startOffset + 1, len))) || {};
        runs.push({ text: text.slice(r.startOffset, r.endOffset), bold: !!props.bold, italic: !!props.italic, underline: !!props.underline, color: props.textColor || null });
      }
      if (!runs.length && text) runs.push({ text, bold: false, italic: false, underline: false, color: null });
      const align = ALIGN_TO_CSS[(json(doc.getParaPropertiesAt(s, p)) || {}).alignment] || '';
      const inner = runs.filter((r) => r.text).length ? runsToHtml(runs.filter((r) => r.text)) : '<br>';
      const htmlBlock = `<p data-s="${s}" data-p="${p}"${align && align !== 'justify' ? ` style="text-align:${align}"` : ''}>${inner}</p>`;
      blocks.push(htmlBlock);
      original.set(key, htmlBlock);
    }
  }
  page.innerHTML = blocks.join('') || '<p><br></p>';
  stage.append(h('div', { class: 'simple-hint' }, '간단 편집 · 글자와 기본 서식만 바뀌고, 나머지 모양은 원본 그대로 유지됩니다'), page);

  let dirty = false;
  page.addEventListener('input', () => (dirty = true));
  // 문단을 나누면 새 문단은 원래 번호를 물려받지 않게
  page.addEventListener('input', () => {
    const seen = new Set();
    page.querySelectorAll('p[data-p]').forEach((el) => {
      const k = `${el.dataset.s}:${el.dataset.p}`;
      if (seen.has(k)) { delete el.dataset.s; delete el.dataset.p; } else seen.add(k);
    });
  });
  const stopBar = buildRichToolbar(toolbar, { focusTarget: () => page, features: {}, detail: false, onChange: () => (dirty = true) });

  // ---------- 저장: 바뀐 문단만 엔진에 반영 ----------
  function rewrite(s, p, block) {
    const len = doc.getParagraphLength(s, p);
    if (len) doc.deleteText(s, p, 0, len);
    const runs = paragraphRuns(block);
    const text = runs.map((r) => r.text).join('');
    if (text) {
      doc.insertText(s, p, 0, text);
      let off = 0;
      for (const r of runs) {
        doc.applyCharFormat(s, p, off, off + r.text.length, JSON.stringify({ bold: r.bold, italic: r.italic, underline: r.underline, textColor: r.color || '#000000' }));
        off += r.text.length;
      }
    }
    const align = blockAlign(block);
    if (align) doc.applyParaFormat(s, p, JSON.stringify({ alignment: align }));
  }

  function applyEdits() {
    const domBlocks = [...page.children].filter((el) => el.matches('p, div, h1, h2, h3, li, ul, ol'));
    for (let s = 0; s < doc.getSectionCount(); s++) {
      // 이 구역의 블록: 원래 번호가 있는 것 + 그 뒤에 새로 생긴 것
      let sec = null;
      const mine = [];
      for (const el of domBlocks) {
        if (el.dataset.s !== undefined) sec = Number(el.dataset.s);
        if ((sec ?? 0) === s) mine.push(el);
      }
      const origCount = doc.getParagraphCount(s);
      // 순서가 뒤바뀐 원래 문단은 새 문단으로 취급
      let last = -1;
      for (const el of mine) {
        if (el.dataset.p === undefined) continue;
        const p = Number(el.dataset.p);
        if (p <= last) { delete el.dataset.p; delete el.dataset.s; } else last = p;
      }
      const kept = new Set(mine.filter((el) => el.dataset.p !== undefined).map((el) => Number(el.dataset.p)));
      const removed = [];
      for (let p = origCount - 1; p >= 0; p--) if (!kept.has(p)) removed.push(p);
      if (removed.length === origCount && origCount > 0) removed.pop(); // 문단이 하나는 남아야 함 → 첫 문단은 비워서 재사용
      for (const p of removed) doc.deleteParagraph(s, p);
      const removedSorted = removed.slice().sort((a, b) => a - b);
      const curIndex = (p) => p - removedSorted.filter((x) => x < p).length;
      let k = -1;
      let shift = 0;
      for (const el of mine) {
        if (el.dataset.p !== undefined) {
          const p = Number(el.dataset.p);
          k = curIndex(p) + shift;
          if (el.classList.contains('hwp-obj')) continue;
          const now = el.outerHTML;
          if (now !== original.get(`${s}:${p}`)) rewrite(s, k, el);
        } else if (k < 0) {
          // 맨 앞에 새 문단
          const reuse = removed.length === origCount - 1 && !kept.size; // 모두 지웠다면 남겨 둔 첫 문단 재사용
          if (!reuse) { doc.splitParagraph(s, 0, 0); shift += 1; }
          k = 0;
          rewrite(s, k, el);
        } else {
          doc.splitParagraph(s, k, doc.getParagraphLength(s, k));
          k += 1;
          shift += 1;
          rewrite(s, k, el);
        }
      }
    }
  }

  return {
    page,
    get dirty() { return dirty; },
    markSaved() { dirty = false; },
    // 상세 편집으로 넘길 때도 지금까지 고친 내용을 담아 넘김
    async toBytes(format = 'hwp') {
      applyEdits();
      const bytes = format === 'hwpx' ? doc.exportHwpx() : doc.exportHwp();
      // 저장 뒤 이어서 편집해도 맞도록: 엔진의 지금 문단 순서대로 화면 번호를 다시 붙이고 '원본'을 지금 상태로
      let s = 0;
      let p = 0;
      original.clear();
      for (const el of [...page.children]) {
        if (el.dataset.s !== undefined && Number(el.dataset.s) !== s) { s = Number(el.dataset.s); p = 0; }
        el.dataset.s = String(s);
        el.dataset.p = String(p);
        if (!el.classList.contains('hwp-obj')) original.set(`${s}:${p}`, el.outerHTML);
        p += 1;
      }
      return bytes;
    },
    async toBlob(format = 'hwp') {
      const bytes = await this.toBytes(format);
      return new Blob([bytes], { type: format === 'hwpx' ? 'application/hwp+zip' : 'application/x-hwp' });
    },
    destroy() { stopBar(); try { doc.free?.(); } catch { /* 이미 해제 */ } },
    escHtml,
  };
}
