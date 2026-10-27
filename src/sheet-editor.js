import * as XLSX from 'xlsx';
import { h, toast, icon } from './ui.js';
import { evaluate } from './formula.js';

const PAGE_ROWS = 500;
const MAX_COLS = 260; // 화면에 만드는 열 수 상한 (파일이 수만 열을 주장해도 그대로 그리지 않음)

export function createSheetEditor(stage, toolbar, data) {
  const wb = data ? XLSX.read(data, { type: 'array', cellFormula: true, cellNF: true, cellDates: true }) : XLSX.utils.book_new();
  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');

  let sheetName = wb.SheetNames[0];
  let ws = wb.Sheets[sheetName];
  let sel = { r: 0, c: 0 };
  let editing = null;
  let dirty = false;
  let shownRows = 0;
  const undo = [];
  let cache = new Map();

  const addrInput = h('div', { class: 'addr' }, 'A1');
  const fx = h('input', { placeholder: '값 또는 =SUM(A1:A5) 같은 수식', onkeydown: (e) => {
    if (e.key === 'Enter') { commit(sel, fx.value); move(1, 0); grid.focus(); }
    if (e.key === 'Escape') { fx.value = rawOf(sel.r, sel.c); grid.focus(); }
  } });
  const table = h('table', { class: 'grid' });
  const grid = h('div', { class: 'grid-scroll', tabindex: '0' }, table);
  const tabs = h('div', { class: 'sheet-tabs' });
  const wrap = h('div', { class: 'sheet-wrap' }, h('div', { class: 'formula-bar' }, addrInput, h('b', { style: 'color:var(--ink-2)' }, 'fx'), fx), grid, tabs);
  stage.append(wrap);

  toolbar.append(
    h('button', { title: '실행 취소 (Ctrl+Z)', onclick: doUndo }, icon('undo')),
    h('span', { class: 'sep' }),
    h('button', { title: '아래에 행 더 보기', onclick: () => { addRows(50); } }, '+ 행'),
    h('button', { title: '오른쪽에 열 추가', onclick: () => { addCol(); render(); } }, '+ 열'),
    h('button', { title: '선택 칸 위 숫자 합계', onclick: autoSum }, 'Σ 합계'),
    h('span', { class: 'sep' }),
    h('button', { title: '새 시트', onclick: addSheet }, '+ 시트'),
  );
  toolbar.hidden = false;

  // ---------- 데이터 접근 ----------
  const range = () => XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const key = (r, c) => XLSX.utils.encode_cell({ r, c });
  const cellAt = (r, c) => ws[key(r, c)];

  function rawOf(r, c) {
    const cell = cellAt(r, c);
    if (!cell) return '';
    if (cell.f) return `=${cell.f}`;
    if (cell.v instanceof Date) return cell.w ?? cell.v.toISOString().slice(0, 10);
    return cell.v == null ? '' : String(cell.v);
  }

  function valueOf(r, c, stack = new Set()) {
    const cell = cellAt(r, c);
    if (!cell) return '';
    if (!cell.f) return cell.v instanceof Date ? cell.w ?? cell.v.toISOString().slice(0, 10) : cell.v ?? '';
    const k = key(r, c);
    if (cache.has(k)) return cache.get(k);
    if (stack.has(k)) return '#REF!';
    stack.add(k);
    let v = evaluate(cell.f, (rr, cc) => valueOf(rr, cc, stack));
    stack.delete(k);
    // 지원하지 않는 함수는 원본 파일에 저장돼 있던 값을 그대로 보여줌
    if (v === '#NAME?' && cell.v !== undefined && !cell.edited) v = cell.v;
    cache.set(k, v);
    return v;
  }

  function display(r, c) {
    const cell = cellAt(r, c);
    if (!cell) return '';
    if (!cell.f && cell.w && !cell.edited) return cell.w;
    const v = valueOf(r, c);
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('ko-KR') : v.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v ?? '');
  }

  function extend(r, c) {
    const rg = range();
    rg.e.r = Math.max(rg.e.r, r);
    rg.e.c = Math.max(rg.e.c, c);
    ws['!ref'] = XLSX.utils.encode_range(rg);
  }

  function addCol() {
    const rg = range();
    const cols = Math.min(Math.max(rg.e.c + 4, 12), MAX_COLS);
    extend(rg.e.r, cols - 3);
  }

  function commit(pos, text, record = true) {
    const k = key(pos.r, pos.c);
    const before = ws[k] ? { ...ws[k] } : undefined;
    if (text === '' || text == null) delete ws[k];
    else if (text.startsWith('=') && text.length > 1) ws[k] = { t: 'n', f: text.slice(1), edited: true };
    else if (/^-?\d+(\.\d+)?$/.test(text.replace(/,/g, ''))) ws[k] = { t: 'n', v: Number(text.replace(/,/g, '')), edited: true };
    else if (/^(true|false)$/i.test(text)) ws[k] = { t: 'b', v: /^true$/i.test(text), edited: true };
    else ws[k] = { t: 's', v: text, edited: true };
    if (record) undo.push({ k, before, sheet: sheetName });
    extend(pos.r, pos.c);
    dirty = true;
    recalcAll();
  }

  function recalcAll() {
    cache = new Map();
    table.querySelectorAll('td[data-k]').forEach((td) => {
      const { r, c } = XLSX.utils.decode_cell(td.dataset.k);
      paintCell(td, r, c);
    });
  }

  function doUndo() {
    const last = undo.pop();
    if (!last) return toast('되돌릴 작업이 없습니다');
    if (last.sheet !== sheetName) switchSheet(last.sheet);
    if (last.before) ws[last.k] = last.before; else delete ws[last.k];
    recalcAll();
    select(XLSX.utils.decode_cell(last.k));
  }

  // ---------- 화면 ----------
  function colName(c) { return XLSX.utils.encode_col(c); }

  function paintCell(td, r, c) {
    const text = display(r, c);
    td.textContent = text;
    const v = cellAt(r, c);
    td.classList.toggle('num', Boolean(v?.t === 'n' || (v?.f && typeof valueOf(r, c) === 'number')));
  }

  function render() {
    const rg = range();
    const cols = Math.min(Math.max(rg.e.c + 4, 12), MAX_COLS);
    shownRows = Math.min(Math.max(rg.e.r + 30, 60), Math.max(PAGE_ROWS, shownRows));
    const thead = h('thead', {}, h('tr', {}, h('th', {}), ...Array.from({ length: cols }, (_, c) => h('th', {}, colName(c)))));
    const tbody = h('tbody');
    for (let r = 0; r < shownRows; r++) tbody.append(rowEl(r, cols));
    table.replaceChildren(thead, tbody);
    if (rg.e.r + 1 > shownRows) {
      tbody.append(h('tr', {}, h('th', {}), h('td', { colspan: cols, style: 'text-align:center;color:#2a7;cursor:pointer', onclick: () => addRows(PAGE_ROWS) }, `행 ${shownRows + 1}~ 더 보기 (전체 ${rg.e.r + 1}행)`)));
    }
    renderTabs();
    select(sel, false);
  }

  function rowEl(r, cols) {
    const tr = h('tr', {}, h('th', {}, String(r + 1)));
    for (let c = 0; c < cols; c++) {
      const td = h('td', { 'data-k': key(r, c) });
      paintCell(td, r, c);
      tr.append(td);
    }
    return tr;
  }

  function addRows(n) {
    shownRows += n;
    const rg = range();
    if (shownRows > rg.e.r) extend(shownRows - 1, rg.e.c);
    render();
  }

  function renderTabs() {
    tabs.replaceChildren(...wb.SheetNames.map((name) =>
      h('button', { class: name === sheetName ? 'on' : '', onclick: () => switchSheet(name) }, name)));
  }

  function switchSheet(name) {
    stopEdit(true);
    sheetName = name;
    ws = wb.Sheets[name];
    sel = { r: 0, c: 0 };
    shownRows = 0;
    cache = new Map();
    render();
  }

  function addSheet() {
    let n = wb.SheetNames.length + 1;
    while (wb.SheetNames.includes(`Sheet${n}`)) n++;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), `Sheet${n}`);
    dirty = true;
    switchSheet(`Sheet${n}`);
  }

  function autoSum() {
    let top = sel.r - 1;
    while (top >= 0 && typeof valueOf(top, sel.c) === 'number') top--;
    if (top === sel.r - 1) return toast('선택한 칸 바로 위에 숫자가 있어야 합니다');
    const col = colName(sel.c);
    commit(sel, `=SUM(${col}${top + 2}:${col}${sel.r})`);
    select(sel);
  }

  function tdAt(r, c) { return table.querySelector(`td[data-k="${key(r, c)}"]`); }

  function select(pos, scroll = true) {
    table.querySelector('td.sel')?.classList.remove('sel');
    sel = { r: Math.max(0, pos.r), c: Math.max(0, pos.c) };
    if (sel.r >= shownRows) addRows(PAGE_ROWS);
    const td = tdAt(sel.r, sel.c);
    if (!td) { extend(0, sel.c); render(); return; }
    td.classList.add('sel');
    if (scroll) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    addrInput.textContent = key(sel.r, sel.c);
    fx.value = rawOf(sel.r, sel.c);
  }

  function move(dr, dc) { stopEdit(true); select({ r: sel.r + dr, c: sel.c + dc }); }

  function startEdit(initial) {
    const td = tdAt(sel.r, sel.c);
    if (!td) return;
    editing = { ...sel };
    const input = h('input', { value: initial ?? rawOf(sel.r, sel.c) });
    td.classList.add('editing');
    td.replaceChildren(input);
    input.focus();
    if (initial == null) input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stopEdit(true); move(1, 0); grid.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); stopEdit(true); move(0, e.shiftKey ? -1 : 1); grid.focus(); }
      else if (e.key === 'Escape') { stopEdit(false); grid.focus(); }
      e.stopPropagation();
    });
    input.addEventListener('input', () => (fx.value = input.value));
    input.addEventListener('blur', () => stopEdit(true));
  }

  function stopEdit(save) {
    if (!editing) return;
    const pos = editing;
    editing = null;
    const td = tdAt(pos.r, pos.c);
    const input = td?.querySelector('input');
    td?.classList.remove('editing');
    if (save && input && input.value !== rawOf(pos.r, pos.c)) commit(pos, input.value);
    else if (td) paintCell(td, pos.r, pos.c);
    if (pos.r === sel.r && pos.c === sel.c) fx.value = rawOf(sel.r, sel.c);
  }

  table.addEventListener('click', (e) => {
    const td = e.target.closest('td[data-k]');
    if (!td || td.classList.contains('editing')) return;
    const pos = XLSX.utils.decode_cell(td.dataset.k);
    if (pos.r === sel.r && pos.c === sel.c && !editing) startEdit();
    else { stopEdit(true); select(pos, false); }
  });
  table.addEventListener('dblclick', (e) => { if (e.target.closest('td[data-k]') && !editing) startEdit(); });

  grid.addEventListener('keydown', (e) => {
    if (editing) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] };
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (e.key === 'F2') { e.preventDefault(); startEdit(); return; }
    if (moves[e.key]) { e.preventDefault(); const [dr, dc] = moves[e.key]; move(e.shiftKey && e.key === 'Tab' ? 0 : dr, e.shiftKey && e.key === 'Tab' ? -1 : dc); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(sel, ''); select(sel, false); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(e.key); }
  });

  render();
  grid.focus();

  // ---------- 저장 ----------
  function finalize() {
    stopEdit(true);
    for (const name of wb.SheetNames) {
      const s = wb.Sheets[name];
      const prev = ws;
      ws = s;
      cache = new Map();
      for (const k of Object.keys(s)) {
        if (k[0] === '!') continue;
        const cell = s[k];
        if (cell.f) {
          const { r, c } = XLSX.utils.decode_cell(k);
          const v = valueOf(r, c);
          if (typeof v === 'number') { cell.t = 'n'; cell.v = v; }
          else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; }
          else if (typeof v === 'string' && v.startsWith('#')) { cell.t = 'e'; cell.v = undefined; cell.w = v; }
          else { cell.t = 's'; cell.v = String(v); }
        }
        if (cell.edited) { delete cell.w; delete cell.edited; cell.z = cell.z && cell.t === 'n' ? cell.z : undefined; }
      }
      ws = prev;
    }
    cache = new Map();
  }

  return {
    grid,
    get dirty() { return dirty; },
    markSaved() { dirty = false; },
    toXlsx() {
      finalize();
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },
    toCsv() {
      finalize();
      return new Blob(['﻿' + XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8' });
    },
    sheetName: () => sheetName,
  };
}
