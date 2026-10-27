// 한글(HWP/HWPX) 편집: 앱에 함께 넣은 rhwp-studio(오프라인 빌드)를 화면 안에 띄움
import { h } from './ui.js';

export async function createHwpEditor(stage, data, name) {
  const { createEditor } = await import('@rhwp/editor');
  const host = h('div', { class: 'hwp-edit-host' });
  stage.append(host);
  // 앱 안의 /hwp-studio/ 를 씀 → 인터넷 연결·외부 서버 없이 동작
  const studioUrl = new URL('hwp-studio/index.html', location.href).href; // 폴더 주소만 쓰면 일부 환경에서 앱 첫 화면이 대신 열림
  const editor = await createEditor(host, { studioUrl, renderer: 'canvas2d' });
  await editor.loadFile(new Uint8Array(data), name, { skipUnsavedGuard: true });

  // 나갈 때 '저장 안 함' 확인을 위해 편집 여부를 주기적으로 읽어 둠
  let dirty = false;
  const timer = setInterval(async () => {
    try { dirty = (await editor.getDocumentState()).dirty; } catch { /* 편집기 준비 중 */ }
  }, 1500);

  return {
    page: host,
    get dirty() { return dirty; },
    markSaved() { dirty = false; editor.notifySaved?.(name).catch(() => {}); },
    async toBlob(format) {
      const bytes = format === 'hwpx' ? await editor.exportHwpx() : await editor.exportHwp();
      return new Blob([bytes], { type: format === 'hwpx' ? 'application/hwp+zip' : 'application/x-hwp' });
    },
    destroy() { clearInterval(timer); try { editor.destroy(); } catch { /* 이미 닫힘 */ } },
  };
}
