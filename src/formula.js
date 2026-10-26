// 아주 작은 수식 계산기: + - * / ^ &, 비교, 셀 참조(A1), 범위(A1:B3), 함수
const FUNCS = {
  SUM: (a) => flat(a).filter(isNum).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => { const n = flat(a).filter(isNum); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : err('#DIV/0!'); },
  MIN: (a) => Math.min(...flat(a).filter(isNum)),
  MAX: (a) => Math.max(...flat(a).filter(isNum)),
  COUNT: (a) => flat(a).filter(isNum).length,
  COUNTA: (a) => flat(a).filter((x) => x !== '' && x != null).length,
  ROUND: (a) => { const [x, d = 0] = a.map(num); const f = 10 ** d; return Math.round(x * f) / f; },
  ABS: (a) => Math.abs(num(a[0])),
  IF: (a) => (truthy(a[0]) ? a[1] : a[2] ?? false),
  AND: (a) => flat(a).every(truthy),
  OR: (a) => flat(a).some(truthy),
  CONCAT: (a) => flat(a).join(''),
  LEN: (a) => String(a[0] ?? '').length,
  TODAY: () => new Date().toISOString().slice(0, 10),
};
FUNCS.AVG = FUNCS.AVERAGE;
FUNCS.CONCATENATE = FUNCS.CONCAT;

class FormulaError extends Error {}
const err = (code) => { throw new FormulaError(code); };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const flat = (a) => a.flat(Infinity);
const truthy = (x) => (typeof x === 'string' ? x !== '' && x.toUpperCase() !== 'FALSE' : Boolean(x));
function num(x) {
  if (Array.isArray(x)) x = flat(x)[0];
  if (x === '' || x == null) return 0;
  if (typeof x === 'boolean') return x ? 1 : 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : err('#VALUE!');
}

export function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function tokenize(src) {
  const re = /\s*(?:(\d+(?:\.\d+)?%?)|("(?:[^"]|"")*")|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|(<=|>=|<>|[-+*/^&(),=<>:]))/y;
  const out = [];
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(start))) break; err('#NAME?'); }
    if (m[1]) out.push({ t: 'num', v: m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]) });
    else if (m[2]) out.push({ t: 'str', v: m[2].slice(1, -1).replace(/""/g, '"') });
    else if (m[3]) out.push({ t: 'ref', v: m[3].replace(/\$/g, '').toUpperCase() });
    else if (m[4]) out.push({ t: 'name', v: m[4].toUpperCase() });
    else out.push({ t: 'op', v: m[5] });
  }
  return out;
}

// getCell(r, c) → 값 (숫자/문자/불리언)
export function evaluate(formula, getCell) {
  try {
    const toks = tokenize(formula.replace(/^=/, ''));
    let i = 0;
    const peek = () => toks[i];
    const take = (v) => { const t = toks[i]; if (v && t?.v !== v) err('#ERROR!'); i++; return t; };

    const refVal = (ref) => {
      const parse = (s) => { const m = s.match(/([A-Z]+)(\d+)/); return [Number(m[2]) - 1, colToNum(m[1])]; };
      if (ref.includes(':')) {
        const [a, b] = ref.split(':').map(parse);
        const rows = [];
        for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++) {
          const row = [];
          for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) row.push(getCell(r, c));
          rows.push(row);
        }
        return rows;
      }
      return getCell(...parse(ref));
    };

    const primary = () => {
      const t = take();
      if (!t) err('#ERROR!');
      if (t.t === 'num' || t.t === 'str') return t.v;
      if (t.t === 'ref') return refVal(t.v);
      if (t.t === 'name') {
        if (t.v === 'TRUE') return true;
        if (t.v === 'FALSE') return false;
        const fn = FUNCS[t.v];
        if (!fn) err('#NAME?');
        take('(');
        const args = [];
        if (peek()?.v !== ')') { do { args.push(compare()); } while (peek()?.v === ',' && take()); }
        take(')');
        return fn(args);
      }
      if (t.v === '(') { const v = compare(); take(')'); return v; }
      if (t.v === '-') return -num(unary());
      if (t.v === '+') return num(unary());
      return err('#ERROR!');
    };
    const unary = () => primary();
    const power = () => { let v = unary(); while (peek()?.v === '^') { take(); v = num(v) ** num(unary()); } return v; };
    const term = () => {
      let v = power();
      while (peek()?.v === '*' || peek()?.v === '/') {
        const op = take().v; const r = num(power());
        if (op === '/' && r === 0) err('#DIV/0!');
        v = op === '*' ? num(v) * r : num(v) / r;
      }
      return v;
    };
    const sum = () => { let v = term(); while (peek()?.v === '+' || peek()?.v === '-') { const op = take().v; v = op === '+' ? num(v) + num(term()) : num(v) - num(term()); } return v; };
    const concat = () => { let v = sum(); while (peek()?.v === '&') { take(); v = `${v ?? ''}${sum() ?? ''}`; } return v; };
    const compare = () => {
      let v = concat();
      while (['=', '<>', '<', '>', '<=', '>='].includes(peek()?.v)) {
        const op = take().v; const r = concat();
        v = { '=': v == r, '<>': v != r, '<': v < r, '>': v > r, '<=': v <= r, '>=': v >= r }[op];
      }
      return v;
    };
    const result = compare();
    if (i < toks.length) err('#ERROR!');
    return Array.isArray(result) ? flat(result)[0] : result;
  } catch (e) {
    return e instanceof FormulaError ? e.message : '#ERROR!';
  }
}
