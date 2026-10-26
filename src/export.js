// 편집기 내용(HTML) → DOCX / PDF / TXT
const HEADINGS = { H1: 'HEADING_1', H2: 'HEADING_2', H3: 'HEADING_3', H4: 'HEADING_4' };

function cssColor(value) {
  if (!value) return undefined;
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
    return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.slice(1);
  if (/^#[0-9a-f]{3}$/i.test(value)) return value.slice(1).split('').map((c) => c + c).join('');
  return undefined;
}

function sizeToHalfPt(value) {
  const pt = value.match(/([\d.]+)pt/);
  if (pt) return Math.round(parseFloat(pt[1]) * 2);
  const px = value.match(/([\d.]+)px/);
  if (px) return Math.round(parseFloat(px[1]) * 0.75 * 2);
  return undefined;
}

function dataUrlToBytes(src) {
  const [head, b64] = src.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = (head.match(/image\/(png|jpe?g|gif|bmp)/)?.[1] || 'png').replace('jpeg', 'jpg');
  return { bytes, type };
}

export async function htmlToDocx(root) {
  const D = await import('docx');

  function runs(node, fmt = {}) {
    const out = [];
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.replace(/\s+/g, ' ');
        if (text) out.push(new D.TextRun({ text, ...fmt }));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (tag === 'BR') { out.push(new D.TextRun({ break: 1 })); continue; }
      if (tag === 'IMG') { const img = imageRun(child); if (img) out.push(img); continue; }
      const f = { ...fmt };
      const st = child.style;
      if (tag === 'B' || tag === 'STRONG' || st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) f.bold = true;
      if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') f.italics = true;
      if (tag === 'U' || st.textDecorationLine?.includes('underline') || st.textDecoration?.includes('underline')) f.underline = {};
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || st.textDecorationLine?.includes('line-through') || st.textDecoration?.includes('line-through')) f.strike = true;
      const color = cssColor(st.color || child.getAttribute('color'));
      if (color) f.color = color;
      const bg = cssColor(st.backgroundColor);
      if (bg) f.shading = { type: D.ShadingType.CLEAR, fill: bg, color: 'auto' };
      if (st.fontSize) { const s = sizeToHalfPt(st.fontSize); if (s) f.size = s; }
      if (tag === 'SUP') f.superScript = true;
      if (tag === 'SUB') f.subScript = true;
      out.push(...runs(child, f));
    }
    return out;
  }

  function imageRun(img) {
    if (!img.src?.startsWith('data:image')) return null;
    try {
      const { bytes, type } = dataUrlToBytes(img.src);
      let w = img.naturalWidth || img.width || 300;
      let hgt = img.naturalHeight || img.height || 200;
      if (w > 600) { hgt = Math.round(hgt * 600 / w); w = 600; }
      return new D.ImageRun({ type, data: bytes, transformation: { width: w, height: hgt } });
    } catch {
      return null;
    }
  }

  function alignment(el) {
    const a = el.style?.textAlign || el.getAttribute?.('align');
    return { center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED }[a];
  }

  function paragraph(el, extra = {}) {
    const children = runs(el);
    return new D.Paragraph({ children: children.length ? children : [new D.TextRun('')], alignment: alignment(el), ...extra });
  }

  function table(el) {
    const rows = [...el.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr')].map((tr) =>
      new D.TableRow({
        children: [...tr.children].map((cell) => new D.TableCell({
          children: blocks(cell).length ? blocks(cell) : [new D.Paragraph('')],
          columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
          rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        })),
      }));
    return new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } });
  }

  function blocks(container, level = 0) {
    const out = [];
    let inline = [];
    const flush = () => {
      if (!inline.length) return;
      const wrap = document.createElement('p');
      inline.forEach((n) => wrap.append(n.cloneNode(true)));
      if (wrap.textContent.trim() || wrap.querySelector('img')) out.push(paragraph(wrap));
      inline = [];
    };
    for (const node of container.childNodes) {
      const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName : null;
      if (!tag || ['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'FONT', 'A', 'BR', 'IMG', 'SUP', 'SUB', 'MARK', 'CODE'].includes(tag)) {
        inline.push(node);
        continue;
      }
      flush();
      if (HEADINGS[tag]) out.push(paragraph(node, { heading: D.HeadingLevel[HEADINGS[tag]] }));
      else if (tag === 'P' || tag === 'DIV' || tag === 'BLOCKQUOTE' || tag === 'PRE') {
        if (node.querySelector(':scope > p, :scope > div, :scope > table, :scope > ul, :scope > ol, :scope > h1, :scope > h2')) out.push(...blocks(node, level));
        else out.push(paragraph(node, tag === 'BLOCKQUOTE' ? { indent: { left: 720 } } : {}));
      } else if (tag === 'UL' || tag === 'OL') {
        for (const li of node.children) {
          const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
          const clone = li.cloneNode(true);
          clone.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => n.remove());
          out.push(paragraph(clone, tag === 'UL'
            ? { bullet: { level } }
            : { numbering: { reference: 'num', level } }));
          nested.forEach((n) => { const wrap = document.createElement('div'); wrap.append(n.cloneNode(true)); out.push(...blocks(wrap, level + 1)); });
        }
      } else if (tag === 'TABLE') out.push(table(node), new D.Paragraph(''));
      else if (tag === 'HR') out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } }));
      else out.push(...blocks(node, level));
    }
    flush();
    return out;
  }

  const levels = [0, 1, 2, 3].map((level) => ({
    level, format: [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN, D.LevelFormat.DECIMAL][level],
    text: `%${level + 1}.`, alignment: D.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

  const doc = new D.Document({
    creator: '클린오피스',
    styles: { default: { document: { run: { font: '맑은 고딕', size: 22 } } } },
    numbering: { config: [{ reference: 'num', levels }] },
    sections: [{ children: blocks(root) }],
  });
  return D.Packer.toBlob(doc);
}

// 화면 요소 → A4 PDF (이미지 방식이라 서식이 화면 그대로 나옴)
export async function elementToPdf(el) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: el.scrollWidth });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const sliceH = Math.floor(canvas.width * (pageH / pageW));
  for (let y = 0, i = 0; y < canvas.height; y += sliceH, i++) {
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = Math.min(sliceH, canvas.height - y);
    part.getContext('2d').drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
    if (i > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (part.height * pageW) / canvas.width);
  }
  return pdf.output('blob');
}

export function htmlToText(el) {
  return new Blob([el.innerText], { type: 'text/plain;charset=utf-8' });
}
