// 파일 열기·저장을 기기에 맞게 처리
// - 안드로이드: 기본 파일 선택창(구글 드라이브·원드라이브 등 포함) → 같은 파일에 다시 저장
// - PC 크롬·엣지: 파일 핸들로 같은 파일에 다시 저장
// - 그 밖의 브라우저: 파일 고르기 + 다운로드
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const DocFiles = registerPlugin('DocFiles');
const hasFsAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/x-hwp': ['.hwp', '.hwpx'],
  'text/plain': ['.txt', '.md'],
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
};

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwp: 'application/x-hwp',
  txt: 'text/plain',
};

export function b64ToBuffer(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const extOf = (n) => (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

// 파일 고르기 → { name, data, src } 또는 null(취소)
// fallbackInput: 크롬·엣지가 아닐 때 쓸 <input type=file>
export async function pickFile(fallbackInput) {
  if (isNative) {
    try {
      const r = await DocFiles.open();
      return { name: r.name, data: b64ToBuffer(r.data), src: { name: r.name, saf: { uri: r.uri, writable: r.writable } } };
    } catch (e) {
      if (e?.code === 'CANCELLED') return null;
      throw e;
    }
  }
  if (hasFsAccess) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: '문서', accept: ACCEPT }], excludeAcceptAllOption: false });
      const file = await handle.getFile();
      return { name: file.name, data: await file.arrayBuffer(), src: { name: file.name, handle } };
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
  }
  fallbackInput.click();
  return null; // input change 이벤트에서 처리
}

// 같은 파일에 다시 저장할 수 있는지
export function canSaveInPlace(src, fileName) {
  if (!src) return false;
  const sameExt = (n) => extOf(n) === extOf(fileName);
  if (src.saf) return src.saf.writable !== false && sameExt(src.name || '');
  if (src.handle) return sameExt(src.handle.name);
  return false;
}

// 같은 파일에 저장. 실패하면 false
export async function saveInPlace(src, blob) {
  if (src.saf) {
    try {
      await DocFiles.write({ uri: src.saf.uri, data: await blobToBase64(blob) });
      return true;
    } catch {
      src.saf.writable = false;
      return false;
    }
  }
  if (src.handle) {
    const ok = (await src.handle.queryPermission?.({ mode: 'readwrite' })) === 'granted'
      || (await src.handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
    if (!ok) return false;
    const w = await src.handle.createWritable();
    await w.write(blob);
    await w.close();
    return true;
  }
  return false;
}

// 다른 이름으로 저장 → 새 src (취소하면 null)
export async function saveAs(name, blob) {
  if (isNative) {
    try {
      const r = await DocFiles.create({ name, mime: blob.type || MIME[extOf(name)] || 'application/octet-stream', data: await blobToBase64(blob) });
      return { name: r.name, saf: { uri: r.uri, writable: r.writable }, savedName: r.name };
    } catch (e) {
      if (e?.code === 'CANCELLED') return null;
      throw e;
    }
  }
  if ('showSaveFilePicker' in window) {
    try {
      const ext = extOf(name);
      const mime = blob.type || MIME[ext] || 'application/octet-stream';
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: ext ? [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }] : undefined });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { name: handle.name, handle, savedName: handle.name };
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
  }
  // 다른 브라우저: 다운로드
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { downloaded: true, savedName: name };
}

// 최근 문서 다시 열기: 원래 위치에서 최신 내용 읽기 (안 되면 null)
export async function reread(src) {
  try {
    if (src?.saf && isNative) {
      const r = await DocFiles.read({ uri: src.saf.uri });
      src.saf.writable = r.writable;
      return { name: r.name, data: b64ToBuffer(r.data) };
    }
    if (src?.handle) {
      const ok = (await src.handle.queryPermission?.({ mode: 'read' })) === 'granted'
        || (await src.handle.requestPermission?.({ mode: 'read' })) === 'granted';
      if (!ok) return null;
      const f = await src.handle.getFile();
      return { name: f.name, data: await f.arrayBuffer() };
    }
  } catch {
    return null;
  }
  return null;
}
