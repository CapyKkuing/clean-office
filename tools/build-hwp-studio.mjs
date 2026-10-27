// 한글(HWP) 편집기 rhwp-studio 를 소스에서 빌드해 public/hwp-studio 에 넣는다.
// - 버전: 설치된 @rhwp/core 와 같은 태그를 받아 엔진(WASM)도 그 npm 패키지 것을 그대로 씀 (Rust 빌드 불필요)
// - 외부 웹폰트(CDN) 끔, 한컴 OCX 호환 플러그인 제외, 오프라인 동작
// 사용: node tools/build-hwp-studio.mjs   (git·npm 필요, 처음 몇 분)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'node_modules', '@rhwp', 'core');
const version = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')).version;
const WORK = path.join(os.tmpdir(), `rhwp-studio-build-${version}`);
const OUT = path.join(ROOT, 'public', 'hwp-studio');
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

console.log(`rhwp-studio v${version} 빌드 → ${OUT}`);
if (!fs.existsSync(path.join(WORK, 'rhwp-studio'))) {
  fs.rmSync(WORK, { recursive: true, force: true });
  run(`git clone --depth 1 --branch v${version} --filter=blob:none --sparse https://github.com/edwardkim/rhwp.git "${WORK}"`, os.tmpdir());
  run('git sparse-checkout set rhwp-studio npm/editor npm/hwpctrl-ocx', WORK);
}

// 엔진: npm 의 @rhwp/core 를 studio 가 기대하는 ../pkg 자리에 둠
const pkg = path.join(WORK, 'pkg');
fs.mkdirSync(pkg, { recursive: true });
for (const f of ['rhwp.js', 'rhwp_bg.wasm', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts']) fs.copyFileSync(path.join(CORE, f), path.join(pkg, f));

const studio = path.join(WORK, 'rhwp-studio');
run('npm ci --ignore-scripts', studio);
run('npx vite build --base=./', studio, { RHWP_WITHOUT_HWPCTRL: '1', RHWP_DISABLE_EXTERNAL_WEBFONTS: '1' });

// 앱에 필요 없는 것 정리: 예제 문서, 자체 서비스워커(우리 앱 것과 겹침), 타입 파일
const dist = path.join(studio, 'dist');
for (const p of ['samples', 'sw.js', 'registerSW.js', 'rhwp.d.ts', 'rhwp_bg.wasm.d.ts', 'rhwp.js', 'manifest.webmanifest']) fs.rmSync(path.join(dist, p), { recursive: true, force: true });
for (const f of fs.readdirSync(dist)) if (/^workbox-.*\.js$/.test(f)) fs.rmSync(path.join(dist, f));
const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, '').replace(/<link rel="manifest"[^>]*>/, '');
fs.writeFileSync(indexPath, html);

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(dist, OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'VERSION.txt'), `rhwp-studio v${version} (MIT, https://github.com/edwardkim/rhwp) — 클린오피스용 오프라인 빌드\n`);
console.log('완료:', OUT);
