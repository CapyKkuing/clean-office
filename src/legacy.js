// 옛 오피스 형식(.doc 워드 97-2003, .ppt 파워포인트 97-2003)에서 글자만 꺼내기
// 서식·그림은 꺼내지 않음. 꺼낸 글자는 DOCX/PPTX 로 바꿔 편집할 수 있음.
const MAX_CHARS = 2_000_000;

async function readCfb(data) {
  const CFB = (await import('cfb')).default;
  return CFB.read(new Uint8Array(data), { type: 'array' });
}

function stream(cfb, CFB, name) {
  const entry = CFB.find(cfb, name);
  return entry?.content ? new Uint8Array(entry.content) : null;
}

// ---------- DOC ----------
// MS-DOC: FIB → 조각표(Clx/PlcPcd) → 조각마다 압축(cp1252)/유니코드(UTF-16) 글자
export async function extractDoc(data) {
  const CFB = (await import('cfb')).default;
  const cfb = await readCfb(data);
  const word = stream(cfb, CFB, 'WordDocument');
  if (!word || word.length < 0x200) throw new Error('워드 97-2003 문서가 아닙니다');
  const dv = new DataView(word.buffer, word.byteOffset, word.byteLength);
  if (dv.getUint16(0, true) !== 0xa5ec) throw new Error('워드 문서 표식이 없습니다');
  const flags = dv.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error('암호가 걸린 문서는 열 수 없습니다');
  const table = stream(cfb, CFB, (flags & 0x0200) ? '1Table' : '0Table');
  if (!table) throw new Error('문서 구조를 읽지 못했습니다');

  const ccpText = dv.getUint32(64 + 3 * 4, true);
  const fibRgFcLcb = 154;
  const fcClx = dv.getUint32(fibRgFcLcb + 33 * 8, true);
  const lcbClx = dv.getUint32(fibRgFcLcb + 33 * 8 + 4, true);
  const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);

  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + tv.getInt16(p + 1, true); // Prc 건너뜀
  if (table[p] !== 0x02) throw new Error('글자 위치표를 찾지 못했습니다');
  const lcb = tv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = (lcb - 4) / 12;
  const cp = (i) => tv.getUint32(plc + i * 4, true);
  const win1252 = new TextDecoder('windows-1252');
  const utf16 = new TextDecoder('utf-16le');

  let text = '';
  for (let i = 0; i < n && text.length < Math.min(ccpText, MAX_CHARS); i++) {
    const start = cp(i);
    if (start >= ccpText) break;
    const stop = Math.min(cp(i + 1), ccpText);
    const pcd = plc + (n + 1) * 4 + i * 8;
    const fcRaw = tv.getUint32(pcd + 2, true);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    const count = stop - start;
    if (compressed) {
      const off = fc / 2;
      text += win1252.decode(word.subarray(off, off + count));
    } else {
      text += utf16.decode(word.subarray(fc, fc + count * 2));
    }
  }
  return { kind: 'doc', paragraphs: cleanWordText(text) };
}

function cleanWordText(t) {
  // 필드: 0x13 코드 0x14 결과 0x15 → 결과만 남김
  let out = '';
  let depth = 0;
  let inCode = [];
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) { depth++; inCode.push(true); continue; }
    if (c === 0x14) { if (depth) inCode[inCode.length - 1] = false; continue; }
    if (c === 0x15) { if (depth) { depth--; inCode.pop(); } continue; }
    if (depth && inCode[inCode.length - 1]) continue;
    out += ch;
  }
  return out
    .replace(/\x07/g, '\t')          // 표 칸 끝
    .replace(/[\x0b]/g, '\n')         // 줄바꿈
    .replace(/[\x0c\x0e]/g, '\r')     // 쪽·구역 나눔
    .replace(/[\x00-\x08\x0f-\x1f]/g, (m) => (m === '\t' ? m : ''))
    .split('\r')
    .map((s) => s.replace(/\t+$/, '').trimEnd());
}

// ---------- PPT ----------
// 레코드: [ver/instance 2][type 2][len 4] — 슬라이드 목록(SlideListWithText) 안의 글자 레코드를 모음
export async function extractPpt(data) {
  const CFB = (await import('cfb')).default;
  const cfb = await readCfb(data);
  const doc = stream(cfb, CFB, 'PowerPoint Document');
  if (!doc) throw new Error('파워포인트 97-2003 문서가 아닙니다');
  if (CFB.find(cfb, 'EncryptedSummary')) throw new Error('암호가 걸린 문서는 열 수 없습니다');
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);
  const utf16 = new TextDecoder('utf-16le');
  const latin1 = new TextDecoder('windows-1252');

  const fromList = [];
  const fromSlides = [];
  let total = 0;

  function walk(start, end, ctx, depth) {
    let p = start;
    while (p + 8 <= end && depth < 32) {
      const verInst = dv.getUint16(p, true);
      const type = dv.getUint16(p + 2, true);
      const len = dv.getUint32(p + 4, true);
      const body = p + 8;
      const next = body + len;
      if (next > end || len > doc.length) break;
      const ver = verInst & 0x0f;
      const inst = verInst >> 4;
      if (ver === 0x0f) {
        let c = ctx;
        if (type === 0x0ff0 && inst === 0) c = { ...ctx, list: true };
        if (type === 0x03ee) { fromSlides.push({ lines: [], type: null }); c = { ...ctx, slide: true }; }
        walk(body, next, c, depth + 1);
      } else if (ctx.list && type === 0x03f3) {
        fromList.push({ lines: [], type: null });
      } else if (type === 0x0f9f) {
        const target = ctx.list ? fromList.at(-1) : ctx.slide ? fromSlides.at(-1) : null;
        if (target) target.pending = dv.getUint32(body, true);
      } else if ((type === 0x0fa0 || type === 0x0fa8) && total < MAX_CHARS) {
        const text = type === 0x0fa0 ? utf16.decode(doc.subarray(body, next)) : latin1.decode(doc.subarray(body, next));
        total += text.length;
        const target = ctx.list ? fromList.at(-1) : ctx.slide ? fromSlides.at(-1) : null;
        if (target) target.lines.push({ textType: target.pending ?? 1, text });
      }
      p = next;
    }
  }
  walk(0, doc.length, {}, 0);

  const pick = fromList.some((s) => s.lines.length) ? fromList : fromSlides;
  const slides = pick.filter((s) => s.lines.length).map((s) => {
    const titleLine = s.lines.find((l) => l.textType === 0 || l.textType === 6);
    let title = titleLine ? titleLine.text.replace(/[\r\x0b]+/g, ' ').trim() : '';
    const body = s.lines.filter((l) => l !== titleLine)
      .flatMap((l) => l.text.split(/[\r\x0b]/))
      .map((x) => x.trim()).filter(Boolean);
    // 제목 칸이 따로 없는 슬라이드는 첫 줄을 제목으로
    if (!title && body.length) title = body.shift();
    return { title, body };
  });
  return { kind: 'ppt', slides };
}

// ---------- 새 형식으로 바꾸기 ----------
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function docToEditorHtml(paragraphs) {
  return paragraphs.map((p) => {
    if (!p.trim()) return '<p><br></p>';
    if (p.includes('\t')) return `<p>${p.split('\t').map(escHtml).join(' &nbsp;│&nbsp; ')}</p>`;
    return `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export async function pptToPptxBlob(slides) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  for (const s of slides) {
    const slide = pres.addSlide();
    if (s.title) slide.addText(s.title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 28, bold: true, fontFace: 'Malgun Gothic', color: '17201C' });
    if (s.body.length) {
      slide.addText(s.body.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: s.title ? 1.4 : 0.5, w: 8.8, h: s.title ? 3.9 : 4.8, fontSize: 18, fontFace: 'Malgun Gothic', color: '333333', valign: 'top' });
    }
  }
  return pres.write({ outputType: 'blob' });
}
