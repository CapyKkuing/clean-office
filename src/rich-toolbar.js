// 모든 편집 화면(워드·파워포인트·한글)이 함께 쓰는 서식 도구모음
// - 간단 편집: 되돌리기 · 굵게/기울임/밑줄 · 글자색 · 정렬 (+목록: 지원하는 형식만)
// - 상세 편집: 위에 더해 문단 스타일 · 글자 크기 · 취소선 · 형광펜 · 표 · 그림 · 구분선 (형식이 지원하는 것만)
// 편집 대상은 contenteditable 요소들. 브라우저 편집 명령(execCommand)으로 서식을 바꿈.
import { h, icon } from './ui.js';

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

// features: { lists, headings, size, strike, highlight, table, image, hr }
// detail: 상세 도구를 보일지
// history: { undo(), redo() } 를 주면 글자 편집 중이 아닐 때 되돌리기 버튼이 그것을 부름 (슬라이드 도형 이동 등)
export function buildRichToolbar(toolbar, { focusTarget, features = {}, detail = false, onChange = () => {}, history = null }) {
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('defaultParagraphSeparator', false, 'p');

  const focus = () => {
    const sel = document.getSelection();
    const inEditable = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('[contenteditable="true"]');
    if (!inEditable) focusTarget()?.focus();
  };
  const cmd = (name, value = null) => () => { focus(); document.execCommand(name, false, value); onChange(); refresh(); };

  const colorTool = (title, value, command, highlight) => {
    const bar = h('i', { class: 'color-bar', style: `background:${value}` });
    const input = h('input', { type: 'color', value, title, oninput: (e) => { bar.style.background = e.target.value; cmd(command, e.target.value)(); } });
    return h('label', { class: `tb color-tool${highlight ? ' hl' : ''}`, title }, h('span', {}, '가'), bar, input);
  };

  const toggles = {
    bold: h('button', { title: '굵게 (Ctrl+B)', onclick: cmd('bold') }, h('b', {}, '가')),
    italic: h('button', { title: '기울임 (Ctrl+I)', onclick: cmd('italic') }, h('i', {}, '가')),
    underline: h('button', { title: '밑줄 (Ctrl+U)', onclick: cmd('underline') }, h('u', {}, '가')),
  };
  if (detail && features.strike) toggles.strikeThrough = h('button', { title: '취소선', onclick: cmd('strikeThrough') }, h('s', {}, '가'));

  const items = [
    h('button', { title: '실행 취소', onclick: history ? () => (history.undo() === false && cmd('undo')()) : cmd('undo') }, icon('undo')),
    h('button', { title: '다시 실행', onclick: history ? () => (history.redo() === false && cmd('redo')()) : cmd('redo') }, icon('redo')),
  ];
  if (detail && features.headings) {
    items.push(h('span', { class: 'sep' }), h('select', { title: '문단 스타일', onchange: (e) => { focus(); document.execCommand('formatBlock', false, e.target.value); onChange(); } },
      h('option', { value: 'p' }, '본문'), h('option', { value: 'h1' }, '제목 1'), h('option', { value: 'h2' }, '제목 2'), h('option', { value: 'h3' }, '제목 3')));
  }
  if (detail && features.size) {
    items.push(h('select', { title: '글자 크기', onchange: (e) => { setFontSize(focus, e.target.value); onChange(); e.target.value = ''; } },
      h('option', { value: '' }, '크기'), ...SIZES.map((s) => h('option', { value: s }, `${s}pt`))));
  }
  items.push(h('span', { class: 'sep' }), ...Object.values(toggles), colorTool('글자색', '#c0392b', 'foreColor', false));
  if (detail && features.highlight) items.push(colorTool('형광펜', '#fff176', 'hiliteColor', true));
  items.push(h('span', { class: 'sep' }),
    h('button', { title: '왼쪽 정렬', onclick: cmd('justifyLeft') }, icon('alignLeft')),
    h('button', { title: '가운데 정렬', onclick: cmd('justifyCenter') }, icon('alignCenter')),
    h('button', { title: '오른쪽 정렬', onclick: cmd('justifyRight') }, icon('alignRight')));
  if (features.lists) {
    items.push(h('span', { class: 'sep' }),
      h('button', { title: '글머리 기호 목록', onclick: cmd('insertUnorderedList') }, icon('listBullet')),
      h('button', { title: '번호 목록', onclick: cmd('insertOrderedList') }, icon('listNumber')));
  }
  if (detail && (features.table || features.image || features.hr)) {
    items.push(h('span', { class: 'sep' }));
    if (features.table) items.push(h('button', { title: '표 넣기', onclick: () => insertTable(focus, onChange) }, icon('table')));
    if (features.image) {
      const imgInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => cmd('insertHTML', `<img src="${r.result}" alt="">`)();
        r.readAsDataURL(f);
        e.target.value = '';
      } });
      items.push(h('label', { class: 'tb', title: '그림 넣기' }, icon('image'), imgInput));
    }
    if (features.hr) items.push(h('button', { title: '구분선', onclick: cmd('insertHorizontalRule') }, icon('hr')));
  }
  toolbar.append(...items);
  toolbar.hidden = false;

  function refresh() {
    for (const [name, el] of Object.entries(toggles)) {
      let on = false;
      try { on = document.queryCommandState(name); } catch { /* 일부 브라우저 미지원 */ }
      el.classList.toggle('on', on);
    }
  }
  document.addEventListener('selectionchange', refresh);
  return () => document.removeEventListener('selectionchange', refresh);
}

function setFontSize(focus, pt) {
  if (!pt) return;
  focus();
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  document.execCommand('styleWithCSS', false, true);
  document.querySelectorAll('[contenteditable="true"] font[size="7"]').forEach((f) => {
    const span = document.createElement('span');
    span.style.fontSize = `${pt}pt`;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
}

function insertTable(focus, onChange) {
  const spec = prompt('표 크기 (행 x 열)', '3x3');
  const m = spec?.match(/(\d+)\s*[x×*,]\s*(\d+)/i);
  if (!m) return;
  const rows = Math.min(+m[1], 50);
  const cols = Math.min(+m[2], 12);
  const tr = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
  focus();
  document.execCommand('insertHTML', false, `<table><tbody>${tr.repeat(rows)}</tbody></table><p><br></p>`);
  onChange();
}

// 편집한 HTML 한 문단을 '글자 덩어리' 목록으로 풀기 (한글·파워포인트 저장용)
// 결과: [{ text, bold, italic, underline, color, size(pt, 직접 지정된 것만) }]
export function paragraphRuns(block) {
  const runs = [];
  const walk = (node, fmt) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.textContent.replace(/ /g, ' ');
        if (!text) continue;
        const last = runs.at(-1);
        if (last && last.bold === fmt.bold && last.italic === fmt.italic && last.underline === fmt.underline && last.color === fmt.color && last.size === fmt.size) last.text += text;
        else runs.push({ text, ...fmt });
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'BR') continue;
      const st = n.style;
      const f = { ...fmt };
      if (/^(B|STRONG)$/.test(n.tagName) || st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) f.bold = true;
      if (st.fontWeight === 'normal' || st.fontWeight === '400') f.bold = false;
      if (/^(I|EM)$/.test(n.tagName) || st.fontStyle === 'italic') f.italic = true;
      if (st.fontStyle === 'normal') f.italic = false;
      if (n.tagName === 'U' || /underline/.test(st.textDecorationLine || st.textDecoration || '')) f.underline = true;
      if (st.color || n.getAttribute('color')) f.color = cssToHex(st.color || n.getAttribute('color')) || f.color;
      if (st.fontSize) f.size = cssToPt(st.fontSize) ?? f.size;
      walk(n, f);
    }
  };
  walk(block, { bold: false, italic: false, underline: false, color: null, size: null });
  return runs;
}

function cssToPt(v) {
  const m = /^([\d.]+)(pt|px)$/.exec(v);
  if (!m) return null;
  return m[2] === 'pt' ? Number(m[1]) : Math.round(Number(m[1]) * 0.75 * 2) / 2;
}

export function blockAlign(block) {
  const a = block.style.textAlign;
  return a === 'center' ? 'center' : a === 'right' ? 'right' : a === 'justify' ? 'justify' : a === 'left' ? 'left' : null;
}

export function cssToHex(v) {
  if (!v) return null;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : null;
}

export const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEX = /^#[0-9a-f]{6}$/i;

// 글자 덩어리 → HTML (편집 화면에 띄울 때)
export function runsToHtml(runs) {
  if (!runs.length) return '<br>';
  return runs.map((r) => {
    let s = escHtml(r.text);
    const style = [];
    if (r.bold) style.push('font-weight:bold');
    if (r.italic) style.push('font-style:italic');
    if (r.underline) style.push('text-decoration:underline');
    if (r.color && HEX.test(r.color) && r.color.toLowerCase() !== '#000000') style.push(`color:${r.color}`);
    return style.length ? `<span style="${style.join(';')}">${s}</span>` : s;
  }).join('');
}
