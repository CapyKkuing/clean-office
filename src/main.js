import { App } from '@capacitor/app';
import { h, btn, menu, toast, busy, baseName, extOf, esc, ask, isModalOpen, closeModal } from './ui.js';
import { listRecent, getRecent, saveRecent, removeRecent, clearRecent } from './store.js';
import { shareBlob } from './save.js';
import { viewPdf, viewDocx, viewPptx, viewHwp, viewText, viewImage, viewNotice, sanitizeHtml, neutralizeLinks } from './viewers.js';
import { createDocEditor } from './doc-editor.js';
import { createSheetEditor } from './sheet-editor.js';
import { htmlToDocx, elementToPdf, htmlToText } from './export.js';
import { isNative, DocFiles, MIME, b64ToBuffer, pickFile, canSaveInPlace, saveInPlace, saveAs, reread } from './files.js';
import { KNOWN_EXT, sniffExt } from './sniff.js';
import { getLink, getPcFile, savePc, renderPcBrowser, renderPcPanel } from './pc-link.js';

const $ = (id) => document.getElementById(id);
const home = $('home');
const workspace = $('workspace');
const stage = $('stage');
const toolbar = $('toolbar');
const actions = $('topActions');
const titleEl = $('docTitle');

// current: { name, data, editor, cleanup, src }
// src(파일이 어디서 왔는지): { name, saf:{uri,writable} | handle | pc:{path,mtime} }
let current = null;

// ---------- 화면 전환 ----------
function showHome() {
  current?.cleanup?.();
  current?.editor?.destroy?.();
  current = null;
  stage.replaceChildren();
  toolbar.replaceChildren();
  toolbar.hidden = true;
  actions.replaceChildren();
  workspace.hidden = true;
  home.hidden = false;
  $('btnBack').hidden = true;
  titleEl.hidden = true;
  $('brand').hidden = false;
  document.title = '클린오피스';
  renderRecent();
}

function showWorkspace(name) {
  stage.replaceChildren();
  toolbar.replaceChildren();
  toolbar.hidden = true;
  actions.replaceChildren();
  home.hidden = true;
  workspace.hidden = false;
  $('btnBack').hidden = false;
  $('brand').hidden = window.innerWidth < 640;
  titleEl.hidden = false;
  titleEl.textContent = name;
  document.title = `${name} - 클린오피스`;
  if (history.state?.doc !== true) history.pushState({ doc: true }, '');
}

const isDirty = () => !!(current?.editor?.dirty || current?.carryDirty);

function leave() {
  if (isDirty() && !confirm('저장하지 않은 변경 내용이 있습니다. 나갈까요?')) return false;
  showHome();
  return true;
}

$('btnBack').addEventListener('click', () => { if (leave() && history.state?.doc) history.back(); });
window.addEventListener('popstate', () => {
  if (!current) return;
  if (!leave()) history.pushState({ doc: true }, '');
});

if (isNative) {
  // 뒤로가기: 확인창이 떠 있으면 닫기 → 문서 화면이면 홈으로 → 홈이면 '종료할까요?' 물어보고 종료
  App.addListener('backButton', async () => {
    if (isModalOpen()) return closeModal();
    if (current) return leave();
    if (await ask('클린오피스를 종료할까요?', null, { ok: '종료', cancel: '계속 쓰기' })) App.exitApp();
  });
}

// ---------- 저장 ----------
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

// 기본 저장: 연 곳(같은 파일·PC 폴더)에 다시 저장, 안 되면 위치를 골라 저장
async function persist(fileName, blob, src) {
  const ok = await persistInner(fileName, blob, src);
  // 저장한 문서를 최근 목록에 (다시 열면 저장한 곳에서 읽음)
  if (ok) blob.arrayBuffer().then((buf) => saveRecent(src.name || src.pc?.path.split("/").pop() || fileName, buf, rememberable(src))).catch(() => {});
  return ok;
}

async function persistInner(fileName, blob, src) {
  try {
    if (src.pc) {
      const link = getLink();
      if (!link) { toast('PC 연결이 끊겼습니다. 홈의 "PC 연결"에서 다시 연결하세요', 4500); return false; }
      const same = extOf(src.pc.path) === extOf(fileName);
      busy(true, 'PC에 저장 중…');
      const r = await savePc(link, same ? src.pc.path : dirOf(src.pc.path) + fileName, blob, same ? src.pc.mtime : undefined).finally(() => busy(false));
      if (!r) return false;
      src.pc = r;
      toast(`PC에 저장했습니다: ${r.path}`);
      return true;
    }
    if (canSaveInPlace(src, fileName)) {
      busy(true, '저장 중…');
      const ok = await saveInPlace(src, blob).finally(() => busy(false));
      if (ok) { toast(`저장했습니다: ${src.name || fileName}`); return true; }
      toast('원래 위치에는 저장할 수 없어서, 저장할 곳을 고릅니다', 3500);
    }
    const r = await saveAs(fileName, blob);
    if (!r) return false;
    if (!r.downloaded) { src.name = r.name; src.saf = r.saf; src.handle = r.handle; }
    toast(`저장했습니다: ${r.savedName}`);
    return true;
  } catch (e) {
    toast(`저장하지 못했습니다: ${e.message}`, 5000);
    return false;
  }
}

// 사본으로 내보내기 (PDF·CSV 등): 매번 위치를 고름
async function exportCopy(fileName, makeBlob) {
  try {
    const r = await saveAs(fileName, await makeBlob());
    if (r) toast(`저장했습니다: ${r.savedName}`);
  } catch (e) {
    toast(`저장하지 못했습니다: ${e.message}`, 5000);
  }
}

async function sendToPc(fileName, makeBlob) {
  const link = getLink();
  if (!link) return toast('먼저 홈의 "PC 연결"에서 PC와 연결하세요', 4000);
  busy(true, 'PC로 보내는 중…');
  try {
    const r = await savePc(link, fileName, await makeBlob(), undefined);
    if (r) toast(`PC의 클린오피스 폴더에 보냈습니다: ${fileName}`);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    busy(false);
  }
}

// 문서 화면 공통 메뉴 항목
function commonItems(fileName, makeBlob, src) {
  const items = [['다른 이름으로 저장…', () => exportCopy(fileName, makeBlob)], ['공유하기', async () => shareBlob(fileName, await makeBlob())]];
  if (isNative && getLink() && !src.pc) items.push(['💻 PC로 보내기', () => sendToPc(fileName, makeBlob)]);
  return items;
}

function rememberable(src) {
  if (src.pc) return { src: { name: src.name, pc: src.pc }, key: `pc:${src.pc.path}` };
  if (src.saf) return { src: { name: src.name, saf: src.saf }, key: src.saf.uri };
  if (src.handle) return { src: { name: src.name, handle: src.handle } };
  return undefined;
}

// ---------- 열기 ----------
async function openFile(name, data, { remember = true, src = {} } = {}) {
  // 'fileDown.do'처럼 확장자로 알 수 없으면 내용을 보고 이름에 맞는 확장자를 붙임
  if (!KNOWN_EXT.includes(extOf(name))) {
    const guessed = await sniffExt(data);
    if (guessed) {
      name = `${extOf(name) ? baseName(name) : name}.${guessed}`;
      if (src.name) src.name = name;
    }
  }
  const ext = extOf(name);
  showWorkspace(name);
  current = { name, data, src };
  busy(true);
  try {
    // 보기 부품이 원본 버퍼를 넘겨받아 비울 수 있어 복사본을 저장
    if (remember) saveRecent(name, data.slice(0), rememberable(src)).catch(() => {});
    if (ext === 'pdf') {
      current.cleanup = await viewPdf(stage, data, toolbar);
      viewerActions(name, data, { src });
    } else if (ext === 'docx') {
      current.cleanup = await viewDocx(stage, data, toolbar);
      viewerActions(name, data, { src, edit: () => editDocx(name, data, src) });
    } else if (['xlsx', 'xlsm', 'xls', 'csv', 'ods'].includes(ext)) {
      openSheet(name, data, src);
    } else if (ext === 'pptx') {
      current.cleanup = await viewPptx(stage, data, toolbar);
      viewerActions(name, data, { src, edit: () => editWith('pptx', name, data, src) });
    } else if (ext === 'hwp' || ext === 'hwpx') {
      current.cleanup = await viewHwp(stage, data, toolbar);
      viewerActions(name, data, { src, edit: () => editWith(ext, name, data, src) });
    } else if (['txt', 'md', 'log', 'json'].includes(ext)) {
      viewText(stage, data);
      viewerActions(name, data, { src, edit: () => editText(name, data, src) });
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
      viewImage(stage, data, name);
      viewerActions(name, data, { src });
    } else if (['doc', 'ppt'].includes(ext)) {
      await viewLegacy(name, data, ext);
    } else {
      viewNotice(stage, `<b>.${esc(ext.slice(0, 20)) || '알 수 없는'} 파일은 지원하지 않습니다.</b><br>PDF, DOC, DOCX, XLSX, XLS, CSV, PPT, PPTX, HWP, HWPX, TXT, 이미지 파일을 열 수 있습니다.`);
    }
  } catch (e) {
    console.error(e);
    stage.replaceChildren();
    viewNotice(stage, `<b>파일을 여는 중 문제가 생겼습니다.</b><br>파일이 손상됐거나 암호가 걸려 있을 수 있습니다.<br><small style="color:var(--ink-2)">${esc(String(e.message || e).slice(0, 200))}</small>`);
  } finally {
    busy(false);
  }
}

function viewerActions(name, data, { edit, src } = {}) {
  const blob = () => new Blob([data], { type: MIME[extOf(name)] || 'application/octet-stream' });
  if (edit) actions.append(btn('편집', edit, { primary: true, icon: '✎' }));
  actions.append(btn('더보기', (e) => menu(e.currentTarget, commonItems(name, blob, src || {})), { icon: '⋯', title: '저장·공유·PC로 보내기' }));
}

// ---------- 문서 편집 ----------
async function editDocx(name, data, src) {
  if (!confirm('편집 화면으로 바꿉니다.\n글·표·그림·기본 서식은 유지되지만, 복잡한 레이아웃(머리말, 다단 등)은 단순해질 수 있습니다.\n저장 전까지 원본 파일은 바뀌지 않습니다.')) return;
  busy(true, '편집 준비 중…');
  try {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ arrayBuffer: data.slice(0) });
    openDocEditor(name, await sanitizeHtml(value || '<p><br></p>'), src);
  } finally {
    busy(false);
  }
}

function editText(name, data, src) {
  const text = new TextDecoder('utf-8').decode(data);
  const html = text.split(/\r?\n/).map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</p>`).join('');
  openDocEditor(`${baseName(name)}.docx`, html, src);
}

function openDocEditor(name, html, src = {}) {
  return openEditor('doc', name, { html }, src);
}

// ---------- 편집 화면 (워드·파워포인트·한글 공통) ----------
// 같은 상단 바(간단↔상세 · 더보기 · 저장)와 같은 서식 도구모음. 새로 만들기·불러오기 모두 이 화면으로 들어옴.
// 휴대폰은 '간단 편집'이 기본, 넓은 화면의 워드·파워포인트는 '상세 편집'이 기본. 고른 것은 기억함.
const DETAIL_KEY = 'co-detail-';
function detailPref(kind) {
  try { const v = localStorage.getItem(DETAIL_KEY + kind); if (v !== null) return v === '1'; } catch { /* 저장 불가 */ }
  return kind !== 'hwp' && window.innerWidth >= 900;
}
function setDetailPref(kind, on) {
  try { localStorage.setItem(DETAIL_KEY + kind, on ? '1' : '0'); } catch { /* 저장 불가 */ }
}

async function openEditor(kind, name, payload, src = {}, opts = {}) {
  const detail = opts.detail ?? detailPref(kind);
  const label = { doc: '워드', pptx: '파워포인트', hwp: '한글' }[kind];
  current?.cleanup?.();
  showWorkspace(name);
  busy(true, `${label} 편집 준비 중…`);
  let editor;
  try {
    if (kind === 'doc') {
      editor = createDocEditor(stage, toolbar, payload.html, { detail });
      neutralizeLinks(editor.page);
    } else if (kind === 'pptx') {
      editor = detail
        ? await (await import('./pptx-studio.js')).createPptxStudio(stage, toolbar, payload.data.slice(0))
        : await (await import('./pptx-editor.js')).createPptxEditor(stage, toolbar, payload.data.slice(0));
    } else {
      editor = detail
        ? await (await import('./hwp-editor.js')).createHwpEditor(stage, payload.data.slice(0), name)
        : await (await import('./hwp-simple.js')).createHwpSimpleEditor(stage, toolbar, payload.data.slice(0), name);
    }
  } catch (e) {
    busy(false);
    stage.replaceChildren();
    viewNotice(stage, `<b>${label} 편집 화면을 열지 못했습니다.</b><br><small style="color:var(--ink-2)">${esc(String(e.message || e).slice(0, 200))}</small>`);
    return;
  }
  busy(false);
  current = { name, editor, src, kind, carryDirty: !!opts.dirty, cleanup: () => editor.destroy?.() };
  const base = baseName(name);
  const ext = kind === 'doc' ? 'docx' : extOf(name);
  const saveName = `${base}.${ext}`;
  const make = (fmt = ext) => (kind === 'doc' ? htmlToDocx(editor.page) : editor.toBlob(fmt));

  const save = async () => {
    busy(true, '저장 준비 중…');
    let blob;
    try { blob = await make(); } catch (e) { busy(false); return toast(`저장하지 못했습니다: ${e.message}`, 5000); }
    busy(false);
    if (await persist(saveName, blob, src)) { editor.markSaved(); current.carryDirty = false; }
  };

  // 간단 ↔ 상세 전환: 지금까지 고친 내용을 그대로 들고 넘어감
  const toggle = btn(detail ? '간단 편집' : '상세 편집', async () => {
    busy(true, '편집 화면 바꾸는 중…');
    let next;
    try {
      next = kind === 'doc' ? { html: editor.page.innerHTML } : { data: await (await make()).arrayBuffer() };
    } catch (e) { busy(false); return toast(`바꾸지 못했습니다: ${e.message}`, 5000); }
    busy(false);
    const wasDirty = editor.dirty || current.carryDirty;
    setDetailPref(kind, !detail);
    openEditor(kind, name, next, src, { detail: !detail, dirty: wasDirty });
  }, { title: detail ? '자주 쓰는 도구만 보기' : '모든 편집 도구 보기' });
  toggle.classList.add('mode-toggle');

  const items = [...commonItems(saveName, () => make(), src)];
  if (kind === 'doc') {
    items.push(['PDF로 내보내기', () => exportCopy(`${base}.pdf`, async () => { busy(true, 'PDF 만드는 중…'); try { return await elementToPdf(editor.page); } finally { busy(false); } })],
      ['텍스트(.txt)로 내보내기', () => exportCopy(`${base}.txt`, async () => htmlToText(editor.page))]);
  }
  if (kind === 'hwp') {
    const other = ext === 'hwp' ? 'hwpx' : 'hwp';
    items.push([`${other.toUpperCase()}로 내보내기`, () => exportCopy(`${base}.${other}`, () => make(other))]);
  }
  actions.append(toggle, btn('더보기', (e) => menu(e.currentTarget, items), { icon: '⋯', title: '다른 형식·공유' }),
    btn(src.pc ? 'PC에 저장' : '저장', save, { primary: true, icon: '⤓' }));
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);
  const prevCleanup = current.cleanup;
  current.cleanup = () => { document.removeEventListener('keydown', onKey); prevCleanup(); };
  editor.page?.focus?.();
}

// ---------- 옛 DOC·PPT: 글자 보기 + 새 형식으로 바꾸기 ----------
async function viewLegacy(name, data, ext) {
  const legacy = await import('./legacy.js');
  const res = ext === 'doc' ? await legacy.extractDoc(data) : await legacy.extractPpt(data);
  const base = baseName(name);
  if (res.isDocx) { // 이름만 .doc 이고 속은 DOCX
    stage.replaceChildren();
    current.cleanup = await viewDocx(stage, data, toolbar);
    viewerActions(name, data, { src: current.src, edit: () => editDocx(`${base}.docx`, data, {}) });
    return;
  }
  const empty = ext === 'doc' ? !res.paragraphs.some((p) => p.trim()) : !res.slides.length;
  stage.append(h('div', { class: 'legacy-banner' },
    h('b', {}, res.note ? `${res.note} — 글자만 보여 드립니다` : `예전 형식(.${ext}) 문서라 글자만 보여 드립니다`),
    h('span', {}, ext === 'doc'
      ? '서식·그림은 빠집니다. "워드로 바꾸기"를 누르면 DOCX로 편집·저장할 수 있어요.'
      : '디자인·그림은 빠집니다. "PPTX로 바꾸기"를 누르면 새 파워포인트로 만들어 줍니다.')));
  const body = h('div', { class: 'text-view legacy-text' });
  if (empty) body.textContent = '꺼낼 수 있는 글자가 없습니다.';
  else if (ext === 'doc') body.textContent = res.paragraphs.join('\n');
  else body.append(...res.slides.map((s, i) => h('div', { class: 'legacy-slide' },
    h('b', {}, `${i + 1}. ${s.title || '(제목 없음)'}`), ...s.body.map((t) => h('div', {}, `• ${t}`)))));
  stage.append(body);
  if (empty) return;
  if (ext === 'doc') {
    actions.append(btn('워드로 바꾸기', () => openDocEditor(`${base}.docx`, legacy.docToEditorHtml(res.paragraphs), {}), { primary: true, icon: '✎' }));
  } else {
    actions.append(btn('PPTX로 바꾸기', async () => {
      busy(true, 'PPTX로 바꾸는 중…');
      try {
        const blob = await legacy.pptToPptxBlob(res.slides);
        busy(false);
        openFile(`${base}.pptx`, await blob.arrayBuffer(), { src: {} });
      } catch (e) {
        busy(false);
        toast(`바꾸지 못했습니다: ${e.message}`, 5000);
      }
    }, { primary: true, icon: '⇄' }));
  }
}

// 보기 화면의 '편집' 버튼 → 공통 편집 화면
function editWith(kind, name, data, src) {
  return openEditor(kind === 'pptx' ? 'pptx' : 'hwp', name, { data }, src);
}

// ---------- 시트 편집 ----------
function openSheet(name, data, src = {}) {
  const editor = createSheetEditor(stage, toolbar, data);
  current = { name, data, editor, src };
  const base = baseName(name);
  const xlsx = async () => editor.toXlsx();
  const saveXlsx = async () => { if (await persist(`${base}.xlsx`, editor.toXlsx(), src)) editor.markSaved(); };
  const more = btn('더보기', (e) => menu(e.currentTarget, [
    ...commonItems(`${base}.xlsx`, xlsx, src),
    ['CSV로 내보내기 (현재 시트)', () => exportCopy(`${base}-${editor.sheetName()}.csv`, async () => editor.toCsv())],
    ['PDF로 내보내기 (보이는 표)', () => exportCopy(`${base}.pdf`, async () => { busy(true, 'PDF 만드는 중…'); try { return await elementToPdf(editor.grid.querySelector('table')); } finally { busy(false); } })],
  ]), { icon: '⋯', title: '다른 형식·공유' });
  actions.append(more, btn(src.pc ? 'PC에 저장' : '저장', saveXlsx, { primary: true, icon: '⤓' }));
  document.addEventListener('keydown', onSheetKey);
  current.cleanup = () => document.removeEventListener('keydown', onSheetKey);
  function onSheetKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveXlsx(); }
  }
}

// ---------- 홈 ----------
// 최근 목록에서 뺀 파일은 안드로이드 영구 접근 권한도 돌려줌 (목록에 없는 파일에 앱이 계속 접근할 수 있지 않게)
const forgetSrc = async (src) => { if (isNative && src?.saf?.uri) { try { await DocFiles.forget({ uri: src.saf.uri }); } catch { /* 이미 해제됨 */ } } };

async function renderRecent() {
  const items = await listRecent();
  const list = $('recentList');
  list.replaceChildren(...items.map((it) => {
    const ext = extOf(it.name);
    const cls = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'pptx', 'hwp'].includes(ext) ? `b-${ext}` : ext === 'hwpx' ? 'b-hwp' : 'b-other';
    const where = it.src?.pc ? '💻 PC · ' : '';
    return h('li', { onclick: () => openRecent(it.id) },
      h('span', { class: `badge ${cls}` }, (ext || '?').toUpperCase().slice(0, 4)),
      h('div', { class: 'meta' },
        h('div', { class: 'name' }, it.name),
        h('div', { class: 'sub' }, `${where}${new Date(it.openedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })} · ${formatSize(it.size)}`)),
      h('button', { class: 'del', title: '목록에서 빼기', onclick: async (e) => { e.stopPropagation(); await forgetSrc(it.src); await removeRecent(it.id); renderRecent(); } }, '×'));
  }));
  $('recentEmpty').hidden = items.length > 0;
  $('clearRecent').hidden = items.length === 0;
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 최근 문서: 원래 위치에서 최신 내용을 읽고, 안 되면 이 기기에 남은 사본을 엶
async function openRecent(id) {
  const rec = await getRecent(id);
  if (!rec) return;
  const src = rec.src ? { ...rec.src } : {};
  busy(true, '최신 내용 확인 중…');
  try {
    if (src.pc) {
      const link = getLink();
      if (link) {
        const got = await getPcFile(link, src.pc.path);
        src.pc = { path: src.pc.path, mtime: got.mtime };
        busy(false);
        return openFile(rec.name, got.data, { src });
      }
    } else if (src.saf || src.handle) {
      const got = await reread(src);
      if (got) { busy(false); return openFile(got.name, got.data, { src }); }
    }
  } catch { /* 아래에서 사본으로 */ }
  busy(false);
  if (src.pc || src.saf || src.handle) toast('원래 위치에 연결할 수 없어 이 기기에 남은 사본을 엽니다. 저장할 때 위치를 다시 고르게 됩니다.', 4500);
  openFile(rec.name, rec.data, { src: {} });
}

async function openPicked(file, src = {}) {
  if (!file) return;
  busy(true);
  const data = await file.arrayBuffer();
  busy(false);
  openFile(file.name, data, { src });
}

async function onOpenClick() {
  try {
    const got = await pickFile($('fileInput'));
    if (got) openFile(got.name, got.data, { src: got.src });
  } catch (e) {
    toast(`파일을 열지 못했습니다: ${e.message}`, 5000);
  }
}

function openPcScreen() {
  showWorkspace(isNative ? 'PC 연결' : '폰 연결');
  current = { name: 'pc' };
  if (isNative) renderPcBrowser(stage, (name, data, src) => openFile(name, data, { src }));
  else renderPcPanel(stage);
}

$('openFile').addEventListener('click', onOpenClick);
$('openPc').addEventListener('click', openPcScreen);
$('fileInput').addEventListener('change', (e) => { openPicked(e.target.files[0]); e.target.value = ''; });
$('newDoc').addEventListener('click', () => openDocEditor('새 문서.docx', '<h1>제목</h1><p>여기에 내용을 입력하세요.</p>'));
$('newSheet').addEventListener('click', () => { showWorkspace('새 시트.xlsx'); openSheet('새 시트.xlsx', null); });

// 새 슬라이드: 앱에 들어 있는 빈 서식(16:9, 제목 + 내용)을 열어 바로 글자 편집
$('newSlides').addEventListener('click', async () => {
  busy(true, '새 슬라이드 준비 중…');
  try {
    const data = await (await fetch(new URL('templates/blank.pptx', location.href))).arrayBuffer();
    busy(false);
    editWith('pptx', '새 프레젠테이션.pptx', data, {});
  } catch (e) {
    busy(false);
    toast(`만들지 못했습니다: ${e.message}`, 5000);
  }
});

// 새 한글 문서: 한글 엔진으로 빈 문서를 만들어 편집기로 바로 엶
$('newHwp').addEventListener('click', async () => {
  busy(true, '새 한글 문서 준비 중…');
  try {
    const data = await createBlankHwp();
    busy(false);
    editWith('hwp', '새 한글 문서.hwp', data, {});
  } catch (e) {
    busy(false);
    toast(`만들지 못했습니다: ${e.message}`, 5000);
  }
});

async function createBlankHwp() {
  const lib = await import('@rhwp/core');
  const wasm = await import('@rhwp/core/rhwp_bg.wasm?url');
  globalThis.measureTextWidth ??= (font, text) => {
    const c = (createBlankHwp.ctx ??= document.createElement('canvas').getContext('2d'));
    c.font = font;
    return c.measureText(text).width;
  };
  await lib.default({ module_or_path: wasm.default });
  const doc = lib.HwpDocument.createEmpty();
  doc.createBlankDocument();
  const bytes = doc.exportHwp();
  doc.free?.();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

$('appVersion').textContent = `클린오피스 v${__APP_VERSION__}`;
$('clearRecent').addEventListener('click', async () => { if (confirm('최근 문서 목록을 비울까요? (원본 파일은 지워지지 않습니다)')) { for (const x of await listRecent()) await forgetSrc(x.src); await clearRecent(); renderRecent(); } });

// 카드 문구를 기기에 맞게
if (isNative) {
  $('openPc').querySelector('strong').textContent = 'PC 연결';
  $('openPc').querySelector('small').textContent = '같은 와이파이의 PC 폴더 열기';
}

// 드래그 앤 드롭 (데스크톱)
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('dropHint').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropHint').hidden = true;
  const item = e.dataTransfer?.items?.[0];
  const file = e.dataTransfer?.files?.[0];
  if (!file || (isDirty() && !confirm('저장하지 않은 변경 내용이 있습니다. 새 파일을 열까요?'))) return;
  // 크롬·엣지는 끌어다 놓은 파일도 같은 파일에 다시 저장 가능
  let src = {};
  try {
    const handle = await item?.getAsFileSystemHandle?.();
    if (handle?.kind === 'file') src = { name: handle.name, handle };
  } catch { /* 지원 안 함 */ }
  openPicked(file, src);
});

// 다른 앱에서 "클린오피스로 열기" (안드로이드)
// 앱이 켜지는 순간에는 같은 파일이 두 경로로 올 수 있어 한 번만 엶
let lastIntent = { uri: '', at: 0 };
function openFromIntent(r) {
  if (r?.error) return toast(`파일을 열지 못했습니다: ${r.error}`, 5000);
  if (!r?.data) return;
  if (r.uri === lastIntent.uri && Date.now() - lastIntent.at < 5000) return;
  lastIntent = { uri: r.uri, at: Date.now() };
  if (isDirty() && !confirm('저장하지 않은 변경 내용이 있습니다. 새 파일을 열까요?')) return;
  openFile(r.name, b64ToBuffer(r.data), { src: { name: r.name, saf: { uri: r.uri, writable: r.writable } } });
}
if (isNative) {
  DocFiles.addListener('fileOpened', openFromIntent);
  DocFiles.getLaunchFile().then(openFromIntent).catch((e) => toast(`파일을 열지 못했습니다: ${e.message}`, 5000));
}

// 오프라인 사용 (웹 버전만)
if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

showHome();
