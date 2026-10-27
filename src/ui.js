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

export function btn(label, onclick, opts = {}) {
  return h('button', { class: opts.primary ? 'btn primary' : 'btn', title: opts.title || label, onclick },
    opts.icon ? h('span', {}, opts.icon) : null, h('span', { class: 'lbl' }, label));
}

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
  m.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
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
