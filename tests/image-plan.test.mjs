import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, pageFileName, safeBase, resolvePages, parseRanges, createBackExit, TARGET_DPI, MAX_PIXELS, MAX_SIDE } from '../src/image-plan.js';

test('PDF A4(595×842pt)는 300dpi 그대로: 2480×3508 근처, 줄이지 않음', () => {
  const r = fitScale(595.28, 841.89, TARGET_DPI / 72);
  assert.equal(r.capped, false);
  assert.equal(r.width, 2480);
  assert.equal(r.height, 3507);
});

test('한글 A4(794×1123px@96dpi)도 300dpi 수준', () => {
  const r = fitScale(793.7, 1122.5, TARGET_DPI / 96);
  assert.equal(r.capped, false);
  assert.ok(r.width >= 2470 && r.height >= 3500);
});

test('16:9 슬라이드(1280×720px)는 약 4000px 폭', () => {
  const r = fitScale(1280, 720, TARGET_DPI / 96);
  assert.equal(r.width, 4000);
  assert.equal(r.capped, false);
});

test('너무 큰 쪽은 점 수·한 변 제한 안으로 줄이고 capped 표시', () => {
  const big = fitScale(3000, 3000, TARGET_DPI / 72);
  assert.equal(big.capped, true);
  assert.ok(big.width * big.height <= MAX_PIXELS);
  const tall = fitScale(800, 20000, TARGET_DPI / 96);
  assert.equal(tall.capped, true);
  assert.ok(tall.height <= MAX_SIDE);
  assert.throws(() => fitScale(0, 100, 1));
});

test('파일 이름: 원본이름_p001.png, 1000쪽 넘으면 자리 수 늘림, 못 쓰는 글자 정리', () => {
  assert.equal(pageFileName('보고서', 1, 12), '보고서_p001.png');
  assert.equal(pageFileName('보고서', 12, 12), '보고서_p012.png');
  assert.equal(pageFileName('큰 책', 7, 1500), '큰 책_p0007.png');
  assert.equal(pageFileName('a/b:c*?', 2), 'a_b_c___p002.png');
  assert.equal(safeBase('   '), '문서');
  assert.equal(safeBase('..숨김'), '숨김');
});

test('쪽 고르기: 지금 보는 쪽 / 골라서 / 전체', () => {
  assert.deepEqual(resolvePages('current', { total: 5, current: 2 }), [2]);
  assert.deepEqual(resolvePages('current', { total: 5, current: 9 }), [0]);
  assert.deepEqual(resolvePages('all', { total: 3 }), [0, 1, 2]);
  assert.deepEqual(resolvePages('pick', { total: 5, picked: [4, 1, 1, 7, -1] }), [1, 4]);
  assert.deepEqual(resolvePages('pick', { total: 5, picked: [] }), []);
});

test('번호 글자로 고르기: "1-3, 5" "7~6"', () => {
  assert.deepEqual(parseRanges('1-3, 5', 10), [0, 1, 2, 4]);
  assert.deepEqual(parseRanges('7~6 99 x', 8), [5, 6]);
  assert.deepEqual(parseRanges('', 8), []);
});

test('뒤로가기: 한 번은 안내, 2초 안에 또 누르면 종료, 늦으면 다시 안내', () => {
  let t = 0;
  const g = createBackExit({ windowMs: 2000, now: () => t });
  assert.equal(g.press(), 'hint');
  t = 1500;
  assert.equal(g.press(), 'exit');
  t = 5000;
  assert.equal(g.press(), 'hint');
  t = 7500;
  assert.equal(g.press(), 'hint'); // 2.5초 지남
  g.reset();
  t = 7600;
  assert.equal(g.press(), 'hint'); // 문서 화면 다녀오면 처음부터
});
