// serif の強調記法。`{語}` は強調色、`{語|RRGGBB}` はその色で描く。
// 閉じていない括弧や中身が空のものは記法とみなさず、従来どおり文字として残す（escapeAssText が全角にする）。
export const EMPHASIS_PATTERN = /\{([^{}|]+)(?:\|([0-9A-Fa-f]{6}))?\}/g;

// 記号を取り除いた本文と、強調区間（本文の code point 位置、end は含まない）を返す。
export function parseEmphasis(text) {
  const source = String(text ?? '');
  const spans = [];
  let plain = '';
  let plainLength = 0;
  let last = 0;
  for (const match of source.matchAll(EMPHASIS_PATTERN)) {
    const before = source.slice(last, match.index);
    plain += before;
    plainLength += [...before].length;
    const inner = match[1];
    const innerLength = [...inner].length;
    spans.push({
      start: plainLength,
      end: plainLength + innerLength,
      color: match[2] ? match[2].toUpperCase() : null,
    });
    plain += inner;
    plainLength += innerLength;
    last = match.index + match[0].length;
  }
  plain += source.slice(last);
  return { plain, spans };
}
