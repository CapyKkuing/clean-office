import { h } from './ui.js';
import { buildRichToolbar } from './rich-toolbar.js';

// 워드 문서 편집기 (간단/상세 공통 도구모음 사용)
export function createDocEditor(stage, toolbar, html = '<p><br></p>', { detail = false } = {}) {
  const page = h('div', { class: 'editor-page', contenteditable: 'true', spellcheck: 'false' });
  page.innerHTML = html;
  stage.append(page);

  let dirty = false;
  page.addEventListener('input', () => (dirty = true));
  const stopBar = buildRichToolbar(toolbar, {
    focusTarget: () => page,
    features: { lists: true, headings: true, size: true, strike: true, highlight: true, table: true, image: true, hr: true },
    detail,
    onChange: () => (dirty = true),
  });

  return {
    page,
    get dirty() { return dirty; },
    markSaved() { dirty = false; },
    destroy() { stopBar(); },
  };
}
