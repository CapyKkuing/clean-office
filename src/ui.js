const $ = (id) => document.getElementById(id);

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function busy(on, text = '여는 중…') {
  $('busyText').textContent = text;
  $('busy').hidden = !on;
}

// 작은 DOM 헬퍼: h('button', { class: 'btn', onclick }, '텍스트')
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

// 도구 아이콘 (그림 글자 대신 선 그림: 기기마다 글꼴이 달라 ⯇ 같은 기호가 깨지는 것 방지)
const ICONS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  alignLeft: 'M4 6h16M4 12h10M4 18h14',
  alignCenter: 'M4 6h16M7 12h10M5 18h14',
  alignRight: 'M4 6h16M10 12h10M6 18h14',
  listBullet: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  listNumber: 'M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M4 14.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 3.5h3',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  image: 'M4 5h16v14H4zM8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M20 15l-5-5L5 19',
  hr: 'M4 12h16',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  save: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  swap: 'M7 7h13l-3-3M17 17H4l3 3',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  shape: 'M3 13h9v8H3zM16.5 3l4.5 8h-9z',
  fill: 'M5 11.5 11 5.5l7 7-6 6zM5 11.5h13M20 16s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  front: 'M8 8h12v12H8zM4 16V4h12',
  back: 'M4 4h12v12H4zM8 20h12V8',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};
// 예전 글자 아이콘 → 선 그림 아이콘
const GLYPH = { '⋯': 'more', '⤓': 'save', '✎': 'edit', '⇄': 'swap' };
export function icon(name, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name] || '');
  svg.append(p);
  return svg;
}

export function btn(label, onclick, opts = {}) {
  const ic = opts.icon ? (GLYPH[opts.icon] ? icon(GLYPH[opts.icon], 18) : h('span', {}, opts.icon)) : null;
  return h('button', { class: opts.primary ? 'btn primary' : 'btn', title: opts.title || label, onclick },
    ic, h('span', { class: 'lbl' }, label));
}

// 앱 스타일 확인창 (기본 confirm 대신). 결과: true/false
export function ask(title, message, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) done(false); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('b', { class: 'modal-title' }, title),
        message ? h('p', { class: 'modal-msg' }, message) : null,
        h('div', { class: 'modal-btns' },
          h('button', { class: 'btn', onclick: () => done(false) }, cancel),
          h('button', { class: `btn primary${danger ? ' danger' : ''}`, onclick: () => done(true) }, ok))));
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.btn.primary').focus();
  });
}
export const isModalOpen = () => Boolean(document.querySelector('.modal-wrap'));
export function closeModal() { document.querySelector('.modal-wrap .modal-btns .btn:not(.primary)')?.click(); }

export function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}

export function menu(anchor, items) {
  closeMenus();
  const m = h('div', { class: 'menu' },
    items.map(([label, fn]) => h('button', { onclick: () => { closeMenus(); fn(); } }, label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${r.bottom + 6 + window.scrollY}px`;
  // 버튼 오른쪽 끝에 맞추되, 화면 왼쪽 밖으로 나가면 버튼 왼쪽에 맞춤
  if (r.right - m.offsetWidth < 8) { m.style.left = `${Math.max(8, r.left)}px`; m.style.right = 'auto'; }
  else m.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
}

// HTML 문자열에 끼워 넣을 때 쓰는 글자 치환 (파일 이름 등 외부에서 온 글자용)
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function extOf(name) {
  return (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
}
