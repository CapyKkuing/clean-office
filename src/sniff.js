// 이름만으로 종류를 알 수 없는 파일 (정부·공공기관 사이트의 'fileDown.do', 확장자 없는 이름 등)을
// 파일 앞부분과 안쪽 구조를 보고 판단. 모르면 '' 반환.
export const KNOWN_EXT = ['pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'csv', 'ods', 'pptx', 'hwp', 'hwpx', 'txt', 'md', 'log', 'json', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'doc', 'ppt'];

export async function sniffExt(data) {
  const head = new Uint8Array(data, 0, Math.min(data.byteLength, 8));
  const sig = (...b) => b.every((x, i) => head[i] === x);
  try {
    if (sig(0x25, 0x50, 0x44, 0x46)) return 'pdf';
    if (sig(0x89, 0x50, 0x4e, 0x47)) return 'png';
    if (sig(0xff, 0xd8, 0xff)) return 'jpg';
    if (sig(0x47, 0x49, 0x46, 0x38)) return 'gif';
    if (sig(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
      const CFB = (await import('cfb')).default;
      const cfb = CFB.read(new Uint8Array(data), { type: 'array' });
      const has = (n) => cfb.FullPaths.some((p) => p.replace(/\/$/, '').split('/').pop() === n);
      if (has('FileHeader') && has('BodyText')) return 'hwp';
      if (has('WordDocument')) return 'doc';
      if (has('Workbook') || has('Book')) return 'xls';
      if (has('PowerPoint Document')) return 'ppt';
      return '';
    }
    if (sig(0x50, 0x4b, 0x03, 0x04)) {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(data);
      const names = Object.keys(zip.files);
      const mimetype = ((await zip.file('mimetype')?.async('string')) || '').trim();
      if (mimetype === 'application/hwp+zip' || names.includes('Contents/content.hpf')) return 'hwpx';
      if (mimetype === 'application/vnd.oasis.opendocument.spreadsheet') return 'ods';
      if (names.some((n) => n.startsWith('word/'))) return 'docx';
      if (names.some((n) => n.startsWith('xl/'))) return 'xlsx';
      if (names.some((n) => n.startsWith('ppt/'))) return 'pptx';
    }
  } catch {
    // 손상된 파일 → 모름
  }
  return '';
}
