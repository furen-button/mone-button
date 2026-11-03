// serif の改行と強調記法（{語} / {語|RRGGBB}）を表示用に落とす。規則は src/voiceData.ts の
// normalizeSerifForDisplay と同じ（そちらは全クリップの JSON を読み込むのでここからは import しない）。
export function stripEmphasisForDisplay(serif: string): string {
  return serif
    .replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, (matched) => (/[^\S\r\n]/.test(matched) ? ' ' : ''))
    .replace(/\{([^{}|]+)(?:\|[0-9A-Fa-f]{6})?\}/g, '$1')
}
