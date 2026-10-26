import { h } from './ui.js';

// contenteditable 기반 간단 문서 편집기
export function createDocEditor(stage, toolbar, html = '<p><br></p>') {
  const page = h('div', { class: 'editor-page', contenteditable: 'true', spellcheck: 'false' });
  page.innerHTML = html;
  stage.append(page);
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('defaultParagraphSeparator', false, 'p');

  let dirty = false;
  page.addEventListener('input', () => (dirty = true));

  const cmd = (name, value = null) => () => { page.focus(); document.execCommand(name, false, value); dirty = true; refresh(); };

  const block = h('select', { title: '문단 스타일', onchange: (e) => { page.focus(); document.execCommand('formatBlock', false, e.target.value); dirty = true; } },
    h('option', { value: 'p' }, '본문'), h('option', { value: 'h1' }, '제목 1'), h('option', { value: 'h2' }, '제목 2'), h('option', { value: 'h3' }, '제목 3'));

  const size = h('select', { title: '글자 크기', onchange: (e) => { setFontSize(page, e.target.value); dirty = true; e.target.value = ''; } },
    h('option', { value: '' }, '크기'), ...[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((s) => h('option', { value: s }, `${s}pt`)));

  const color = h('input', { type: 'color', value: '#c0392b', title: '글자색', oninput: (e) => cmd('foreColor', e.target.value)() });
  const mark = h('input', { type: 'color', value: '#fff176', title: '형광펜', oninput: (e) => cmd('hiliteColor', e.target.value)() });

  const toggles = {
    bold: h('button', { title: '굵게 (Ctrl+B)', onclick: cmd('bold') }, h('b', {}, '가')),
    italic: h('button', { title: '기울임 (Ctrl+I)', onclick: cmd('italic') }, h('i', {}, '가')),
    underline: h('button', { title: '밑줄 (Ctrl+U)', onclick: cmd('underline') }, h('u', {}, '가')),
    strikeThrough: h('button', { title: '취소선', onclick: cmd('strikeThrough') }, h('s', {}, '가')),
  };

  const imgInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => cmd('insertHTML', `<img src="${r.result}" alt="">`)();
    r.readAsDataURL(f);
    e.target.value = '';
  } });

  toolbar.append(
    h('button', { title: '실행 취소', onclick: cmd('undo') }, '↶'),
    h('button', { title: '다시 실행', onclick: cmd('redo') }, '↷'),
    h('span', { class: 'sep' }), block, size,
    h('span', { class: 'sep' }), ...Object.values(toggles), color, mark,
    h('span', { class: 'sep' }),
    h('button', { title: '왼쪽 정렬', onclick: cmd('justifyLeft') }, '⯇'),
    h('button', { title: '가운데 정렬', onclick: cmd('justifyCenter') }, '≡'),
    h('button', { title: '오른쪽 정렬', onclick: cmd('justifyRight') }, '⯈'),
    h('span', { class: 'sep' }),
    h('button', { title: '글머리 기호', onclick: cmd('insertUnorderedList') }, '• 목록'),
    h('button', { title: '번호 목록', onclick: cmd('insertOrderedList') }, '1. 목록'),
    h('button', { title: '표 넣기', onclick: () => insertTable(page, () => (dirty = true)) }, '표'),
    h('label', { class: 'tb', title: '그림 넣기' }, '그림', imgInput),
    h('button', { title: '구분선', onclick: cmd('insertHorizontalRule') }, '―'),
  );
  toolbar.hidden = false;

  function refresh() {
    for (const [name, el] of Object.entries(toggles)) {
      let on = false;
      try { on = document.queryCommandState(name); } catch { /* 일부 브라우저 미지원 */ }
      el.classList.toggle('on', on);
    }
  }
  document.addEventListener('selectionchange', refresh);

  return {
    page,
    get dirty() { return dirty; },
    markSaved() { dirty = false; },
    destroy() { document.removeEventListener('selectionchange', refresh); },
  };
}

function setFontSize(page, pt) {
  if (!pt) return;
  page.focus();
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  document.execCommand('styleWithCSS', false, true);
  page.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = document.createElement('span');
    span.style.fontSize = `${pt}pt`;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
  page.querySelectorAll('span').forEach((s) => { if (s.style.fontSize === 'xxx-large') s.style.fontSize = `${pt}pt`; });
}

function insertTable(page, onChange) {
  const spec = prompt('표 크기 (행 x 열)', '3x3');
  const m = spec?.match(/(\d+)\s*[x×*,]\s*(\d+)/i);
  if (!m) return;
  const rows = Math.min(+m[1], 50);
  const cols = Math.min(+m[2], 12);
  const tr = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
  page.focus();
  document.execCommand('insertHTML', false, `<table><tbody>${tr.repeat(rows)}</tbody></table><p><br></p>`);
  onChange();
}
