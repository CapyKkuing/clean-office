import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative, blobToBase64 } from './files.js';

// 다른 앱으로 보내기 (카톡·메일·드라이브 등)
export async function shareBlob(name, blob) {
  if (!isNative) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch { /* 취소 */ }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }
  const res = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
  try { await Share.share({ title: name, files: [res.uri] }); } catch { /* 취소 */ }
}
