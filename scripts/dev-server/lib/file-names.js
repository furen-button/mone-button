// 書き出し名に使えない文字を _ にする（outputBaseName と同じ文字種）。
export function safeStem(label) {
  const stem = String(label || 'video')
    .replace(/[^\p{L}\p{N}_.\- ]/gu, '_')
    .replace(/^\.+/u, '')
    .slice(0, 80)
    .trim();
  return stem || 'video';
}
