// 파워포인트 슬라이드 그리기 (공개 표준 ECMA-376 / ISO 29500 의 PresentationML·DrawingML 구조만 보고 직접 작성)
// 슬라이드 XML → 화면 요소(HTML + SVG). 편집기(pptx-studio)와 썸네일이 함께 씀.
// 단위: EMU(1인치 = 914400). 화면 px = EMU / 9525 (96dpi 기준)

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};
const SVGNS = 'http://www.w3.org/2000/svg';
export const EMU_PX = 9525;
export const px = (emu) => Number(emu || 0) / EMU_PX;

export const kids = (el, ns, name) => (el ? [...el.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === ns && (!name || n.localName === name)) : []);
export const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
export const first = (el, ns, name) => (el ? el.getElementsByTagNameNS(ns, name)[0] || null : null);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
export const relsPathOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');

// ---------- 색 ----------
const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500' };
const hex2rgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let hh = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh /= 6;
  }
  return [hh, s, l];
}
function hsl2rgb([hh, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

// 색 요소(srgbClr·schemeClr 등)를 담은 부모 → CSS 색. 없으면 null
export function colorOf(parent, ctx, phClr) {
  if (!parent) return null;
  const c = kids(parent, NS.a).find((n) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'].includes(n.localName));
  if (!c) return null;
  let hex = null;
  if (c.localName === 'srgbClr') hex = c.getAttribute('val');
  else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') || (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000');
  else if (c.localName === 'prstClr') hex = PRESET[c.getAttribute('val')] || '000000';
  else if (c.localName === 'schemeClr') {
    const v = c.getAttribute('val');
    if (v === 'phClr') return phClr || null;
    hex = ctx.theme?.(v) || null;
  } else if (c.localName === 'scrgbClr') {
    hex = ['r', 'g', 'b'].map((k) => Math.round(Number(c.getAttribute(k)) / 100000 * 255).toString(16).padStart(2, '0')).join('');
  }
  if (!hex) return null;
  let rgb = hex2rgb(hex);
  let alpha = 1;
  for (const m of kids(c, NS.a)) {
    const val = Number(m.getAttribute('val')) / 100000;
    if (m.localName === 'alpha') alpha = val;
    else if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const hsl = rgb2hsl(rgb);
      hsl[2] = m.localName === 'lumMod' ? hsl[2] * val : Math.min(1, hsl[2] + val);
      rgb = hsl2rgb(hsl);
    } else if (m.localName === 'tint') rgb = rgb.map((x) => x + (255 - x) * (1 - val));
    else if (m.localName === 'shade') rgb = rgb.map((x) => x * val);
  }
  const [r, g, b] = rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))));
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(3)})` : `rgb(${r},${g},${b})`;
}

// 채우기 → { css: 'background 값', svg: '채움색' } (없음 → null, noFill → 'none')
function fillOf(spPr, ctx, part, phClr) {
  if (!spPr) return null;
  for (const n of kids(spPr, NS.a)) {
    if (n.localName === 'noFill') return { none: true };
    if (n.localName === 'solidFill') { const c = colorOf(n, ctx, phClr); return c ? { color: c } : null; }
    if (n.localName === 'gradFill') {
      const stops = kids(kid(n, NS.a, 'gsLst'), NS.a, 'gs').map((gs) => ({ pos: Number(gs.getAttribute('pos')) / 1000, c: colorOf(gs, ctx, phClr) || '#fff' }));
      if (!stops.length) return null;
      const ang = Number(kid(n, NS.a, 'lin')?.getAttribute('ang') || 0) / 60000;
      return { color: stops[0].c, gradient: `linear-gradient(${ang + 90}deg, ${stops.map((s) => `${s.c} ${s.pos}%`).join(', ')})` };
    }
    if (n.localName === 'blipFill') {
      const url = ctx.image(part, kid(n, NS.a, 'blip')?.getAttributeNS(NS.r, 'embed'));
      return url ? { image: url } : null;
    }
    if (n.localName === 'pattFill') { const c = colorOf(kid(n, NS.a, 'fgClr'), ctx, phClr); return c ? { color: c } : null; }
    if (n.localName === 'grpFill') return null;
  }
  return null;
}

const DASH = { dash: '4 3', sysDash: '3 1', dot: '1 2', sysDot: '1 1', lgDash: '8 3', dashDot: '4 3 1 3', lgDashDot: '8 3 1 3' };
function lineOf(spPr, ctx, styleEl) {
  const ln = kid(spPr, NS.a, 'ln');
  let color = null; let none = false;
  if (ln) {
    if (kid(ln, NS.a, 'noFill')) none = true;
    else color = colorOf(kid(ln, NS.a, 'solidFill'), ctx);
  }
  const lnRef = kid(styleEl, NS.a, 'lnRef');
  if (!none && !color && lnRef && Number(lnRef.getAttribute('idx')) > 0 && !(ln && ln.getAttribute('w') === '0')) color = colorOf(lnRef, ctx);
  if (none || !color) return null;
  const w = Math.max(0.75, px(ln?.getAttribute('w') || 12700));
  return { color, width: w, dash: DASH[kid(ln, NS.a, 'prstDash')?.getAttribute('val')] || null };
}

// ---------- 도형 모양(경로) ----------
// 자주 쓰는 기본 도형 + 사용자 정의 도형(custGeom)
function presetPath(prst, w, hgt, av) {
  const m = Math.min(w, hgt);
  const adj = (k, d) => (av[k] ?? d) / 100000;
  switch (prst) {
    case 'ellipse': case 'flowChartConnector': return `M0 ${hgt / 2}A${w / 2} ${hgt / 2} 0 1 0 ${w} ${hgt / 2}A${w / 2} ${hgt / 2} 0 1 0 0 ${hgt / 2}Z`;
    case 'roundRect': case 'flowChartAlternateProcess': {
      const r = m * adj('adj', 16667);
      return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${hgt - r}A${r} ${r} 0 0 1 ${w - r} ${hgt}H${r}A${r} ${r} 0 0 1 0 ${hgt - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
    }
    case 'triangle': { const x = w * adj('adj', 50000); return `M${x} 0L${w} ${hgt}H0Z`; }
    case 'rtTriangle': return `M0 0L${w} ${hgt}H0Z`;
    case 'diamond': case 'flowChartDecision': return `M${w / 2} 0L${w} ${hgt / 2}L${w / 2} ${hgt}L0 ${hgt / 2}Z`;
    case 'parallelogram': { const x = m * adj('adj', 25000); return `M${x} 0H${w}L${w - x} ${hgt}H0Z`; }
    case 'trapezoid': { const x = m * adj('adj', 25000); return `M${x} 0H${w - x}L${w} ${hgt}H0Z`; }
    case 'pentagon': return `M${w / 2} 0L${w} ${hgt * 0.38}L${w * 0.82} ${hgt}H${w * 0.18}L0 ${hgt * 0.38}Z`;
    case 'hexagon': { const x = m * adj('adj', 25000); return `M${x} 0H${w - x}L${w} ${hgt / 2}L${w - x} ${hgt}H${x}L0 ${hgt / 2}Z`; }
    case 'octagon': { const x = m * adj('adj', 29289); return `M${x} 0H${w - x}L${w} ${x}V${hgt - x}L${w - x} ${hgt}H${x}L0 ${hgt - x}V${x}Z`; }
    case 'homePlate': { const x = w - m * adj('adj', 50000); return `M0 0H${x}L${w} ${hgt / 2}L${x} ${hgt}H0Z`; }
    case 'chevron': { const x = m * adj('adj', 50000); return `M0 0H${w - x}L${w} ${hgt / 2}L${w - x} ${hgt}H0L${x} ${hgt / 2}Z`; }
    case 'rightArrow': { const t = hgt * adj('adj1', 50000); const hx = w - m * adj('adj2', 50000); const y1 = (hgt - t) / 2; return `M0 ${y1}H${hx}V0L${w} ${hgt / 2}L${hx} ${hgt}V${y1 + t}H0Z`; }
    case 'leftArrow': { const t = hgt * adj('adj1', 50000); const hx = m * adj('adj2', 50000); const y1 = (hgt - t) / 2; return `M${w} ${y1}H${hx}V0L0 ${hgt / 2}L${hx} ${hgt}V${y1 + t}H${w}Z`; }
    case 'upArrow': { const t = w * adj('adj1', 50000); const hy = m * adj('adj2', 50000); const x1 = (w - t) / 2; return `M${x1} ${hgt}V${hy}H0L${w / 2} 0L${w} ${hy}H${x1 + t}V${hgt}Z`; }
    case 'downArrow': { const t = w * adj('adj1', 50000); const hy = hgt - m * adj('adj2', 50000); const x1 = (w - t) / 2; return `M${x1} 0V${hy}H0L${w / 2} ${hgt}L${w} ${hy}H${x1 + t}V0Z`; }
    case 'plus': { const x = m * adj('adj', 25000); return `M${x} 0H${w - x}V${x}H${w}V${hgt - x}H${w - x}V${hgt}H${x}V${hgt - x}H0V${x}H${x}Z`; }
    case 'line': case 'straightConnector1': case 'bentConnector2': case 'bentConnector3': case 'curvedConnector3': return `M0 0L${w} ${hgt}`;
    case 'star5': {
      const pts = [];
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.38 : 1; const a = -Math.PI / 2 + i * Math.PI / 5; pts.push(`${w / 2 + Math.cos(a) * r * w / 2} ${hgt / 2 + Math.sin(a) * r * hgt / 2}`); }
      return `M${pts.join('L')}Z`;
    }
    default: return `M0 0H${w}V${hgt}H0Z`;
  }
}
const OPEN_PRESETS = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'curvedConnector3']);

function customPath(custGeom, w, hgt) {
  let d = '';
  for (const path of kids(kid(custGeom, NS.a, 'pathLst'), NS.a, 'path')) {
    const pw = Number(path.getAttribute('w')) || w * EMU_PX;
    const ph = Number(path.getAttribute('h')) || hgt * EMU_PX;
    const sx = w / pw; const sy = hgt / ph;
    let cx = 0; let cy = 0;
    const pt = (el) => [Number(el.getAttribute('x')) * sx, Number(el.getAttribute('y')) * sy];
    for (const c of kids(path, NS.a)) {
      const ps = kids(c, NS.a, 'pt').map(pt);
      if (c.localName === 'moveTo') { [cx, cy] = ps[0]; d += `M${cx} ${cy}`; }
      else if (c.localName === 'lnTo') { [cx, cy] = ps[0]; d += `L${cx} ${cy}`; }
      else if (c.localName === 'cubicBezTo' && ps.length === 3) { d += `C${ps.map((p) => p.join(' ')).join(' ')}`; [cx, cy] = ps[2]; }
      else if (c.localName === 'quadBezTo' && ps.length === 2) { d += `Q${ps.map((p) => p.join(' ')).join(' ')}`; [cx, cy] = ps[1]; }
      else if (c.localName === 'arcTo') {
        const wR = Number(c.getAttribute('wR')) * sx; const hR = Number(c.getAttribute('hR')) * sy;
        const st = Number(c.getAttribute('stAng')) / 60000 * Math.PI / 180; const sw = Number(c.getAttribute('swAng')) / 60000 * Math.PI / 180;
        const ox = cx - wR * Math.cos(st); const oy = cy - hR * Math.sin(st);
        const ex = ox + wR * Math.cos(st + sw); const ey = oy + hR * Math.sin(st + sw);
        d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey}`;
        cx = ex; cy = ey;
      } else if (c.localName === 'close') d += 'Z';
    }
  }
  return d || `M0 0H${w}V${hgt}H0Z`;
}

// ---------- 위치 ----------
export function xfrmElOf(node) {
  const ln = node.localName;
  if (ln === 'graphicFrame') return kid(node, NS.p, 'xfrm');
  if (ln === 'grpSp') return kid(kid(node, NS.p, 'grpSpPr'), NS.a, 'xfrm');
  return kid(kid(node, NS.p, 'spPr'), NS.a, 'xfrm');
}
export function readXfrm(x) {
  if (!x) return null;
  const off = kid(x, NS.a, 'off'); const ext = kid(x, NS.a, 'ext');
  if (!off || !ext) return null;
  return {
    x: Number(off.getAttribute('x')), y: Number(off.getAttribute('y')),
    w: Number(ext.getAttribute('cx')), h: Number(ext.getAttribute('cy')),
    rot: Number(x.getAttribute('rot') || 0) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1',
  };
}

// ---------- 자리표시자(placeholder) 상속 ----------
export function phOf(node) {
  const nv = kids(node, NS.p).find((n) => /^nv/.test(n.localName));
  const ph = first(nv, NS.p, 'ph');
  if (!ph) return null;
  return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') };
}
const normType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
function findPh(tree, ph) {
  if (!tree || !ph) return null;
  const sps = [...tree.getElementsByTagNameNS(NS.p, 'sp')];
  if (ph.idx != null) { const byIdx = sps.find((s) => phOf(s)?.idx === ph.idx); if (byIdx) return byIdx; }
  return sps.find((s) => phOf(s) && phOf(s).type === ph.type) || sps.find((s) => phOf(s) && normType(phOf(s).type) === normType(ph.type)) || null;
}
// 슬라이드 도형 → [슬라이드, 레이아웃, 마스터] 의 같은 자리표시자 목록
export function phChain(node, ctx) {
  const ph = phOf(node);
  const chain = [node];
  if (!ph) return chain;
  const lay = findPh(ctx.layout?.tree, ph);
  if (lay) chain.push(lay);
  const mas = findPh(ctx.master?.tree, ph.type ? { type: ph.type, idx: null } : ph) || (lay && findPh(ctx.master?.tree, phOf(lay)));
  if (mas) chain.push(mas);
  return chain;
}
export function effectiveXfrm(node, ctx) {
  for (const n of phChain(node, ctx)) { const x = readXfrm(xfrmElOf(n)); if (x) return x; }
  return null;
}

// 글자 기본값: 도형 lstStyle → 레이아웃/마스터 자리표시자 lstStyle → 마스터 txStyles → 프레젠테이션 기본값
function levelStyles(node, ctx, lvl) {
  const out = [];
  const name = `lvl${lvl + 1}pPr`;
  const chain = phChain(node, ctx);
  for (const n of chain) { const ls = kid(kid(n, NS.p, 'txBody'), NS.a, 'lstStyle'); const l = kid(ls, NS.a, name); if (l) out.push(l); }
  const ph = phOf(node);
  const tx = ctx.master?.txStyles;
  if (tx) {
    const t = ph ? normType(ph.type) : null;
    const style = t === 'title' ? 'titleStyle' : t === 'body' ? 'bodyStyle' : ph ? 'otherStyle' : null;
    const l = style ? kid(kid(tx, NS.p, style), NS.a, name) : null;
    if (l) out.push(l);
  }
  const def = kid(ctx.defaultTextStyle, NS.a, name);
  if (def) out.push(def);
  return out;
}
function bodyPrChain(node, ctx) {
  return phChain(node, ctx).map((n) => kid(kid(n, NS.p, 'txBody'), NS.a, 'bodyPr')).filter(Boolean);
}
const attrFrom = (list, a) => { for (const el of list) { const v = el?.getAttribute(a); if (v != null && v !== '') return v; } return null; };

// ---------- 글자 ----------
function fontFamily(rPr, ctx) {
  const f = (kid(rPr, NS.a, 'ea') || kid(rPr, NS.a, 'latin'))?.getAttribute('typeface');
  if (!f) return null;
  if (f.startsWith('+mj')) return ctx.fonts?.major || null;
  if (f.startsWith('+mn')) return ctx.fonts?.minor || null;
  return f;
}

// 문단 하나 → <p> HTML. 상속된 서식은 <p> 에, 직접 지정된 서식은 글자 덩어리(<span>)에 둠 (저장할 때 직접 지정분만 다시 씀)
export function paragraphHtml(p, node, ctx, fallbackColor, fontScale = 1) {
  const pPr = kid(p, NS.a, 'pPr');
  const lvl = Number(pPr?.getAttribute('lvl') || 0);
  const styles = levelStyles(node, ctx, lvl);
  const defR = styles.map((s) => kid(s, NS.a, 'defRPr')).filter(Boolean);
  const pList = [pPr, ...styles];
  const sz = Number(attrFrom(defR, 'sz') || 1800) / 100;
  const css = [`font-size:${sz}pt`];
  const color = defR.map((d) => colorOf(kid(d, NS.a, 'solidFill'), ctx)).find(Boolean) || fallbackColor;
  if (color) css.push(`color:${color}`);
  if (attrFrom(defR, 'b') === '1') css.push('font-weight:bold');
  if (attrFrom(defR, 'i') === '1') css.push('font-style:italic');
  const ff = defR.map((d) => fontFamily(d, ctx)).find(Boolean) || ctx.fonts?.minor;
  if (ff) css.push(`font-family:'${ff.replace(/'/g, '')}',sans-serif`);
  const algn = attrFrom(pList, 'algn');
  const ALG = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
  if (ALG[algn]) css.push(`text-align:${ALG[algn]}`);
  const marL = Number(attrFrom(pList, 'marL') || 0);
  const indent = Number(attrFrom(pList, 'indent') || 0);
  if (marL) css.push(`padding-left:${px(marL)}px`);
  if (indent) css.push(`text-indent:${px(indent)}px`);
  const lnPct = pList.map((x) => first(kid(x, NS.a, 'lnSpc'), NS.a, 'spcPct')).find(Boolean);
  css.push(`line-height:${lnPct ? (Number(lnPct.getAttribute('val')) / 100000 * 1.2).toFixed(2) : '1.2'}`);
  const bef = pList.map((x) => first(kid(x, NS.a, 'spcBef'), NS.a, 'spcPts')).find(Boolean);
  const aft = pList.map((x) => first(kid(x, NS.a, 'spcAft'), NS.a, 'spcPts')).find(Boolean);
  if (bef) css.push(`margin-top:${Number(bef.getAttribute('val')) / 100}pt`);
  if (aft) css.push(`margin-bottom:${Number(aft.getAttribute('val')) / 100}pt`);
  // 글머리 기호
  let bullet = '';
  for (const x of pList) {
    if (!x) continue;
    if (kid(x, NS.a, 'buNone')) break;
    const ch = kid(x, NS.a, 'buChar');
    if (ch) { bullet = ch.getAttribute('char') || '•'; break; }
    if (kid(x, NS.a, 'buAutoNum')) { bullet = '•'; break; }
  }
  // 글자 덩어리
  let html = '';
  for (const n of kids(p, NS.a)) {
    if (n.localName === 'br') { html += '<br>'; continue; }
    if (n.localName !== 'r' && n.localName !== 'fld') continue;
    const rPr = kid(n, NS.a, 'rPr');
    const text = first(n, NS.a, 't')?.textContent ?? '';
    if (!text) continue;
    const st = [];
    if (rPr?.getAttribute('b') === '1') st.push('font-weight:bold');
    else if (rPr?.getAttribute('b') === '0') st.push('font-weight:normal');
    if (rPr?.getAttribute('i') === '1') st.push('font-style:italic');
    const u = rPr?.getAttribute('u');
    if (u && u !== 'none') st.push('text-decoration:underline');
    if (rPr?.getAttribute('sz')) st.push(`font-size:${Number(rPr.getAttribute('sz')) / 100}pt`);
    const c = colorOf(kid(rPr, NS.a, 'solidFill'), ctx);
    if (c) st.push(`color:${c}`);
    const f = fontFamily(rPr, ctx);
    if (f) st.push(`font-family:'${f.replace(/'/g, '')}',sans-serif`);
    html += st.length ? `<span style="${st.join(';')}">${esc(text)}</span>` : esc(text);
  }
  if (!html) {
    const end = kid(p, NS.a, 'endParaRPr');
    const esz = end?.getAttribute('sz');
    html = esz ? `<span style="font-size:${Number(esz) / 100}pt"><br></span>` : '<br>';
  }
  const scale = fontScale !== 1 ? ` data-scale="${fontScale}"` : '';
  return `<p style="${css.join(';')}"${bullet ? ` data-bu="${esc(bullet)}"` : ''}${scale}>${html}</p>`;
}

// ---------- 그리기 ----------
// ctx: { theme(name)→hex, fonts, image(part, rId)→url, layout:{tree,doc,part}, master:{tree,txStyles,part}, defaultTextStyle, part }
export function renderShape(node, ctx, opts = {}) {
  const ln = node.localName;
  const box = effectiveXfrm(node, ctx);
  if (!box && ln !== 'grpSp') return null;
  const el = document.createElement('div');
  el.className = 'sl-shape';
  const place = (b) => {
    el.style.left = `${px(b.x)}px`; el.style.top = `${px(b.y)}px`;
    el.style.width = `${px(b.w)}px`; el.style.height = `${px(b.h)}px`;
    const t = [];
    if (b.rot) t.push(`rotate(${b.rot}deg)`);
    if (b.flipH) t.push('scaleX(-1)');
    if (b.flipV) t.push('scaleY(-1)');
    el.style.transform = t.join(' ');
  };
  if (box) place(box);

  if (ln === 'grpSp') {
    const gx = readXfrm(xfrmElOf(node));
    const xf = xfrmElOf(node);
    const chOff = kid(xf, NS.a, 'chOff'); const chExt = kid(xf, NS.a, 'chExt');
    if (!gx) return null;
    place(gx);
    const cx = Number(chOff?.getAttribute('x') || 0); const cy = Number(chOff?.getAttribute('y') || 0);
    const sx = chExt ? gx.w / (Number(chExt.getAttribute('cx')) || gx.w) : 1;
    const sy = chExt ? gx.h / (Number(chExt.getAttribute('cy')) || gx.h) : 1;
    const inner = document.createElement('div');
    inner.className = 'sl-group';
    inner.style.transform = `scale(${sx},${sy}) translate(${-px(cx)}px,${-px(cy)}px)`;
    for (const c of kids(node, NS.p)) {
      if (!['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'].includes(c.localName)) continue;
      const ce = renderShape(c, ctx, { inGroup: true });
      if (ce) inner.append(ce);
    }
    el.append(inner);
    return el;
  }

  if (ln === 'graphicFrame') {
    const tbl = first(node, NS.a, 'tbl');
    if (tbl) el.append(renderTable(tbl, ctx));
    else { el.classList.add('sl-object'); el.textContent = first(node, NS.a, 'graphicData')?.getAttribute('uri')?.includes('chart') ? '차트' : '개체'; }
    return el;
  }

  const spPr = kid(node, NS.p, 'spPr');
  const styleEl = kid(node, NS.p, 'style');
  const w = px(box.w); const hgt = px(box.h);

  if (ln === 'pic') {
    const blip = first(kid(node, NS.p, 'blipFill'), NS.a, 'blip');
    const url = ctx.image(ctx.part, blip?.getAttributeNS(NS.r, 'embed'));
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.draggable = false;
      const geom = kid(spPr, NS.a, 'prstGeom')?.getAttribute('prst');
      if (geom === 'ellipse') img.style.borderRadius = '50%';
      el.append(img);
    } else { el.classList.add('sl-object'); el.textContent = '그림'; }
    const line = lineOf(spPr, ctx, styleEl);
    if (line) el.style.outline = `${line.width}px solid ${line.color}`;
    return el;
  }

  // sp / cxnSp: 모양(SVG) + 글자
  let fill = null;
  for (const n of phChain(node, ctx)) { fill = fillOf(kid(n, NS.p, 'spPr'), ctx, n === node ? ctx.part : null); if (fill) break; }
  const fillRef = kid(styleEl, NS.a, 'fillRef');
  if (!fill && fillRef && Number(fillRef.getAttribute('idx')) > 0) { const c = colorOf(fillRef, ctx); if (c) fill = { color: c }; }
  const line = lineOf(spPr, ctx, styleEl);
  const prstEl = kid(spPr, NS.a, 'prstGeom');
  const prst = prstEl?.getAttribute('prst') || (ln === 'cxnSp' ? 'line' : 'rect');
  const av = {};
  for (const gd of kids(kid(prstEl, NS.a, 'avLst'), NS.a, 'gd')) { const m = /val\s+(-?\d+)/.exec(gd.getAttribute('fmla') || ''); if (m) av[gd.getAttribute('name')] = Number(m[1]); }
  const cust = kid(spPr, NS.a, 'custGeom');
  if ((fill && !fill.none) || line) {
    if (fill?.image && !cust && prst === 'rect') {
      el.style.background = `center / 100% 100% no-repeat url("${fill.image}")`;
      if (line) el.style.outline = `${line.width}px solid ${line.color}`;
    } else {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'sl-geom');
      svg.setAttribute('width', w); svg.setAttribute('height', hgt);
      svg.setAttribute('viewBox', `0 0 ${w || 1} ${hgt || 1}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', cust ? customPath(cust, w, hgt) : presetPath(prst, w, hgt, av));
      const open = OPEN_PRESETS.has(prst);
      if (fill && !fill.none && !open) {
        if (fill.gradient || fill.image) {
          const id = `g${Math.random().toString(36).slice(2, 9)}`;
          const defs = document.createElementNS(SVGNS, 'defs');
          if (fill.image) {
            defs.innerHTML = `<pattern id="${id}" width="1" height="1" patternContentUnits="objectBoundingBox"><image href="${fill.image}" width="1" height="1" preserveAspectRatio="none"/></pattern>`;
          } else {
            const m = /linear-gradient\(([-\d.]+)deg, (.*)\)$/.exec(fill.gradient);
            const ang = ((Number(m?.[1] || 90) - 90) * Math.PI) / 180;
            const stops = (m?.[2] || '').split(/, (?![^()]*\))/).map((s) => { const k = s.lastIndexOf(' '); return `<stop offset="${s.slice(k + 1)}" stop-color="${s.slice(0, k)}"/>`; }).join('');
            defs.innerHTML = `<linearGradient id="${id}" x1="${0.5 - Math.cos(ang) / 2}" y1="${0.5 - Math.sin(ang) / 2}" x2="${0.5 + Math.cos(ang) / 2}" y2="${0.5 + Math.sin(ang) / 2}">${stops}</linearGradient>`;
          }
          svg.append(defs);
          path.setAttribute('fill', `url(#${id})`);
        } else path.setAttribute('fill', fill.color);
      } else path.setAttribute('fill', 'none');
      if (line) {
        path.setAttribute('stroke', line.color);
        path.setAttribute('stroke-width', line.width);
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        if (line.dash) path.setAttribute('stroke-dasharray', line.dash.split(' ').map((v) => v * line.width).join(' '));
      }
      svg.append(path);
      el.append(svg);
    }
  }

  const txBody = kid(node, NS.p, 'txBody');
  if (txBody) {
    const fontRefColor = colorOf(kid(styleEl, NS.a, 'fontRef'), ctx);
    el.append(renderText(node, txBody, ctx, fontRefColor, w, hgt));
  }
  return el;
}

export function renderText(node, txBody, ctx, fallbackColor, w, hgt) {
  const bps = bodyPrChain(node, ctx);
  const ins = (a, d) => px(attrFrom(bps, a) ?? d);
  const anchor = attrFrom(bps, 'anchor') || 't';
  const vert = attrFrom(bps, 'vert');
  const wrap = attrFrom(bps, 'wrap');
  const fs = bps.map((b) => kid(b, NS.a, 'normAutofit')).find(Boolean)?.getAttribute('fontScale');
  const scale = fs ? Number(fs) / 100000 : 1;
  const tx = document.createElement('div');
  tx.className = 'sl-text';
  tx.style.padding = `${ins('tIns', 45720)}px ${ins('rIns', 91440)}px ${ins('bIns', 45720)}px ${ins('lIns', 91440)}px`;
  tx.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  if (wrap === 'none') tx.style.whiteSpace = 'pre';
  if (vert && vert !== 'horz') tx.style.writingMode = 'vertical-rl';
  if (scale !== 1) { tx.style.zoom = String(scale); tx.style.width = `${w / scale}px`; tx.style.height = `${hgt / scale}px`; }
  const ph = phOf(node);
  const defaultColor = fallbackColor || (ctx.theme?.('tx1') ? `#${ctx.theme('tx1')}` : null);
  tx.innerHTML = kids(txBody, NS.a, 'p').map((p) => paragraphHtml(p, node, ctx, defaultColor)).join('') || '<p><br></p>';
  if (ph) {
    const prompt = { title: '제목을 입력하세요', ctrTitle: '제목을 입력하세요', subTitle: '부제목을 입력하세요' }[ph.type] || '텍스트를 입력하세요';
    tx.dataset.hint = prompt;
  }
  return tx;
}

function renderTable(tbl, ctx) {
  const t = document.createElement('table');
  t.className = 'sl-table';
  const cols = kids(kid(tbl, NS.a, 'tblGrid'), NS.a, 'gridCol').map((g) => px(g.getAttribute('w')));
  const cg = document.createElement('colgroup');
  for (const c of cols) { const col = document.createElement('col'); col.style.width = `${c}px`; cg.append(col); }
  t.append(cg);
  for (const tr of kids(tbl, NS.a, 'tr')) {
    const row = document.createElement('tr');
    row.style.height = `${px(tr.getAttribute('h'))}px`;
    for (const tc of kids(tr, NS.a, 'tc')) {
      if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') continue;
      const td = document.createElement('td');
      if (tc.getAttribute('gridSpan')) td.colSpan = Number(tc.getAttribute('gridSpan'));
      if (tc.getAttribute('rowSpan')) td.rowSpan = Number(tc.getAttribute('rowSpan'));
      const fill = colorOf(kid(kid(tc, NS.a, 'tcPr'), NS.a, 'solidFill'), ctx);
      if (fill) td.style.background = fill;
      const fake = { localName: 'sp', childNodes: [] };
      td.innerHTML = kids(kid(tc, NS.a, 'txBody'), NS.a, 'p').map((p) => paragraphHtml(p, fake, ctx, null)).join('');
      row.append(td);
    }
    t.append(row);
  }
  return t;
}

export function renderBackground(slideEl, ctx, parts) {
  // 슬라이드 → 레이아웃 → 마스터 순서로 처음 나오는 배경
  for (const { doc, part } of parts) {
    const bg = first(kid(first(doc, NS.p, 'cSld'), NS.p, 'bg'), NS.p, 'bgPr') ? kid(kid(first(doc, NS.p, 'cSld'), NS.p, 'bg'), NS.p, 'bgPr') : null;
    const ref = kid(kid(first(doc, NS.p, 'cSld'), NS.p, 'bg'), NS.p, 'bgRef');
    if (bg) {
      const f = fillOf(bg, ctx, part);
      if (f?.image) { slideEl.style.background = `center / cover no-repeat url("${f.image}")`; return; }
      if (f?.gradient) { slideEl.style.background = f.gradient; return; }
      if (f?.color) { slideEl.style.background = f.color; return; }
    }
    if (ref) { const c = colorOf(ref, ctx); if (c) { slideEl.style.background = c; return; } }
  }
  slideEl.style.background = '#fff';
}

export const SHAPE_TAGS = ['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'];
export const spTreeOf = (doc) => first(first(doc, NS.p, 'cSld'), NS.p, 'spTree');

// 슬라이드 전체 그리기: 배경 + 마스터/레이아웃 장식 + 슬라이드 도형
// 결과: { el, shapes: [{ node, el }] }
export function renderSlide(slide, ctx, size) {
  const el = document.createElement('div');
  el.className = 'sl-slide';
  el.style.width = `${px(size.cx)}px`;
  el.style.height = `${px(size.cy)}px`;
  const parts = [{ doc: slide.doc, part: slide.path }];
  if (ctx.layout) parts.push({ doc: ctx.layout.doc, part: ctx.layout.part });
  if (ctx.master) parts.push({ doc: ctx.master.doc, part: ctx.master.part });
  renderBackground(el, ctx, parts);
  const showMaster = slide.doc.documentElement.getAttribute('showMasterSp') !== '0' && ctx.layout?.doc.documentElement.getAttribute('showMasterSp') !== '0';
  const deco = (tree, part) => {
    for (const n of kids(tree, NS.p)) {
      if (!SHAPE_TAGS.includes(n.localName) || phOf(n)) continue;
      const c = renderShape(n, { ...ctx, part, layout: null });
      if (c) { c.classList.add('sl-deco'); el.append(c); }
    }
  };
  if (showMaster && ctx.master) deco(ctx.master.tree, ctx.master.part);
  if (ctx.layout) deco(ctx.layout.tree, ctx.layout.part);
  const shapes = [];
  for (const n of kids(spTreeOf(slide.doc), NS.p)) {
    if (!SHAPE_TAGS.includes(n.localName)) continue;
    const c = renderShape(n, { ...ctx, part: slide.path });
    if (!c) continue;
    el.append(c);
    shapes.push({ node: n, el: c });
  }
  return { el, shapes };
}
