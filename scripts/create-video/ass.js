import { ALIGN, assOverrideColor, rgbToAssBgr } from './config.js';

// ボックス高さ算出とフォント自動縮小で共有する行送り係数。
const LINE_HEIGHT = 1.25;
const KINSOKU_BACKTRACK_LIMIT = 4;
const KINSOKU_MIN_TAIL_UNITS = 6;
const KINSOKU_TAIL_MOVE_LIMIT = 6;

const LINE_START_KINSOKU_CHARS = new Set([
  ...'、。，．・：；？！‼⁉ゝゞヽヾ々ー〜）〕］｝〉》」』】〙〗〟\'"｠»%‰℃°',
  ...'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ',
  ...',.:;?!)]}｡｣､･ｰﾞﾟ',
]);
const RAW_LINE_END_KINSOKU_CHARS = [
  ...'（〔［｛〈《「『【〘〖〝\'"｟«([{｢',
];
// 行頭禁則と行末禁則の実運用集合は必ず素集合に保つ。
// ASCII の引用符は開き/閉じの文脈を持てないため、重複回避として行頭側で扱う。
const LINE_END_KINSOKU_CHARS = new Set(
  RAW_LINE_END_KINSOKU_CHARS.filter((ch) => !LINE_START_KINSOKU_CHARS.has(ch)),
);
for (const ch of LINE_END_KINSOKU_CHARS) {
  if (LINE_START_KINSOKU_CHARS.has(ch)) {
    throw new Error(`禁則集合が重複しています: ${ch}`);
  }
}

export function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) {
    return dateStr || '';
  }
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

export function formatTimestamp(seconds) {
  const total = Math.floor(Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function stripEmoji(text) {
  if (!text) {
    return '';
  }
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[️‍\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, '\n')
    .trim();
}

export function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (c <= 0x2ff) return 0.5;
  if (c >= 0xff61 && c <= 0xff9f) return 0.5;
  return 1;
}

export function wrapText(text, maxUnits, { kinsoku = true } = {}) {
  const input = String(text);
  if (maxUnits <= 0) {
    return normalizeWrappedLines(input.split(/\r?\n/)).join('\n');
  }

  const out = [];
  for (const segment of input.split(/\r?\n/)) {
    if (segment === '') {
      out.push('');
      continue;
    }
    out.push(...wrapSegment(segment, maxUnits, { kinsoku }));
  }
  return normalizeWrappedLines(out).join('\n');
}

function wrapSegment(segment, maxUnits, { kinsoku }) {
  if (kinsoku && maxUnits >= 4) {
    const legacy = wrapSegmentLegacy(segment, maxUnits);
    const wrapped = wrapSegmentWithKinsoku(segment, maxUnits);
    // 行数が増えるくらいなら禁則は諦める。その legacy 側にも空白が残りうるので採用後にトリムする。
    return trimLineEdges(wrapped.length <= legacy.length ? wrapped : legacy);
  }
  return wrapSegmentLegacy(segment, maxUnits);
}

function wrapSegmentLegacy(segment, maxUnits) {
  const out = [];
  let line = '';
  let width = 0;
  let lastSpace = -1;
  const flush = () => {
    out.push(line);
    line = '';
    width = 0;
    lastSpace = -1;
  };

  for (const ch of String(segment)) {
    line += ch;
    width += charWidth(ch);
    if (ch === ' ') {
      lastSpace = line.length - 1;
    }
    if (width >= maxUnits) {
      if (shouldBreakAtSpace(line, lastSpace)) {
        const rest = line.slice(lastSpace + 1);
        out.push(line.slice(0, lastSpace));
        line = rest;
        width = [...line].reduce((sum, c2) => sum + charWidth(c2), 0);
        lastSpace = -1;
      } else {
        flush();
      }
    }
  }
  if (line) out.push(line);
  return out;
}

function wrapSegmentWithKinsoku(segment, maxUnits) {
  const chars = [...String(segment)];
  const out = [];
  let start = 0;
  while (start < chars.length) {
    const br = measureBreak(chars, start, maxUnits);
    if (br.cut >= chars.length) {
      out.push(chars.slice(start).join(''));
      break;
    }

    let cut = br.cut;
    let nextStart = br.nextStart;
    if (!br.bySpace) {
      cut = adjustKinsokuBreak(chars, start, cut);
      nextStart = cut;
    }
    if (cut <= start) {
      cut = br.cut;
      nextStart = br.nextStart;
    }

    out.push(chars.slice(start, cut).join(''));
    start = nextStart;
  }
  return rebalanceShortTail(out, maxUnits);
}

// \an5 の中央寄せでは行頭・行末の空白がその行だけ中心をずらすため、折り返し後に落とす。
// 禁則の後退や短い最終行の再調整で、区切りに使った空白が行端に残ることがある。
function trimLineEdges(lines) {
  return lines.map((line) => line.replace(/^[ \u3000]+|[ \u3000]+$/g, ''));
}

function measureBreak(chars, start, maxUnits) {
  let width = 0;
  let lastSpace = -1;
  for (let i = start; i < chars.length; i++) {
    const ch = chars[i];
    width += charWidth(ch);
    if (ch === ' ') {
      lastSpace = i;
    }
    if (width >= maxUnits) {
      if (lastSpace > start && lastSpace < i) {
        return { cut: lastSpace, nextStart: lastSpace + 1, bySpace: true };
      }
      return { cut: i + 1, nextStart: i + 1, bySpace: false };
    }
  }
  return { cut: chars.length, nextStart: chars.length, bySpace: false };
}

function adjustKinsokuBreak(chars, start, cut) {
  if (!violatesKinsoku(chars, cut)) {
    return cut;
  }
  for (let back = 1; back <= KINSOKU_BACKTRACK_LIMIT; back++) {
    const candidate = cut - back;
    if (candidate <= start) {
      break;
    }
    if (!violatesKinsoku(chars, candidate)) {
      return candidate;
    }
  }
  return cut;
}

function violatesKinsoku(chars, cut) {
  return (
    LINE_END_KINSOKU_CHARS.has(chars[cut - 1]) ||
    (cut < chars.length && LINE_START_KINSOKU_CHARS.has(chars[cut]))
  );
}

function rebalanceShortTail(lines, maxUnits) {
  if (lines.length < 2) {
    return lines;
  }
  const minTail = Math.min(KINSOKU_MIN_TAIL_UNITS, maxUnits);
  const tail = lines.at(-1);
  if (measureWidth(tail) >= minTail) {
    return lines;
  }

  const prev = lines.at(-2);
  const prevChars = [...prev];
  const tailChars = [...tail];
  for (let move = 1; move <= KINSOKU_TAIL_MOVE_LIMIT; move++) {
    const cut = prevChars.length - move;
    if (cut <= 0) {
      break;
    }
    const nextTail = [...prevChars.slice(cut), ...tailChars];
    if (measureWidth(nextTail.join('')) > maxUnits) {
      continue;
    }
    if (violatesKinsoku([...prevChars, ...tailChars], cut)) {
      continue;
    }
    if (measureWidth(nextTail.join('')) >= minTail) {
      return [
        ...lines.slice(0, -2),
        prevChars.slice(0, cut).join(''),
        nextTail.join(''),
      ];
    }
  }
  return lines;
}

function measureWidth(text) {
  return [...String(text)].reduce((sum, ch) => sum + charWidth(ch), 0);
}

function shouldBreakAtSpace(line, lastSpace) {
  return lastSpace > 0 && lastSpace < line.length - 1;
}

function normalizeWrappedLines(lines) {
  const out = [];
  for (const line of lines) {
    if (line === '' && out.at(-1) === '') {
      continue;
    }
    out.push(line);
  }
  while (out[0] === '') {
    out.shift();
  }
  while (out.at(-1) === '') {
    out.pop();
  }
  return out;
}

export function maxUnitsFor(width, marginL, marginR, size) {
  return Math.floor(((width - marginL - marginR) / size) * 0.97);
}

export function boxHeightFor(lines, fs, pad, border) {
  return Math.round(lines * fs * LINE_HEIGHT + pad * 2 + border * 2);
}

export function countLines(text) {
  return String(text || '').split(/\r?\n|\\N/).length;
}

export function resolveTitleText({ clip, config, titleOverride }) {
  const meta = clip?.meta || {};
  const videoId = clip?.videoId || clip?.data?.videoId || meta.videoId;
  if (titleOverride) {
    return titleOverride;
  }
  const override = videoId ? config.telops.title.overrides?.[videoId] : null;
  if (override) {
    return override;
  }
  if (config.telops.title.text) {
    return config.telops.title.text;
  }
  if (clip?.data?.title) {
    return clip.data.title;
  }
  return stripEmoji(meta.title || '');
}

export function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r?\n/g, '\\N');
}

export function escapeFilterPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export function buildAss(elements, { width, height, font }) {
  const lines = [];
  lines.push('[Script Info]');
  lines.push('ScriptType: v4.00+');
  lines.push(`PlayResX: ${width}`);
  lines.push(`PlayResY: ${height}`);
  lines.push('WrapStyle: 0');
  lines.push('ScaledBorderAndShadow: yes');
  lines.push('');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push(`Style: Default,${font},48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,40,40,40,1`);
  lines.push('');
  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  for (const el of elements.filter((item) => item && item.text !== false)) {
    for (const box of boxDialogues(el, width, height)) {
      lines.push(dialogue(box));
    }
    lines.push(dialogue(textDialogue(el, width, height)));
    if (el.progress?.bar) {
      for (const bar of progressBarDialogues(el, width, height)) {
        lines.push(dialogue(bar));
      }
    }
  }

  return lines.join('\n') + '\n';
}

function dialogue({ layer = 1, start = '0:00:00.00', end = '9:59:59.99', text }) {
  return `Dialogue: ${layer},${start},${end},Default,,0,0,0,,${text}`;
}

function textDialogue(el, width, height) {
  const fs = fontSize(el.size, height);
  const pos = el.textPos || alignedPosition(el.align, width, height, el.marginH, el.marginV);
  // ボックス内テキスト（title バー・serif ボックス）は textPos がボックス中心なので、
  // 中央アンカー(\an5)にしてボックス内で水平・垂直とも中央寄せする。
  // それ以外は要素の align どおりに配置する。
  const anchor = el.box?.enabled ? ALIGN.center : alignCode(el.align);
  const overrides = [
    `\\an${anchor}`,
    `\\pos(${Math.round(pos.x)},${Math.round(pos.y)})`,
    `\\fs${fs}`,
    `\\1c${assOverrideColor(el.color || 'FFFFFF')}`,
  ];

  if (el.font) {
    overrides.push(`\\fn${el.font}`);
  }
  if (el.bold) overrides.push('\\b1');
  if (el.outline !== undefined) overrides.push(`\\bord${Number(el.outline)}`);
  if (el.outlineColor) overrides.push(`\\3c${assOverrideColor(el.outlineColor)}`);
  if (el.shadow !== undefined) overrides.push(`\\shad${Number(el.shadow)}`);
  if (el.shadowColor) overrides.push(`\\4c${assOverrideColor(el.shadowColor, shadowAlpha(el.shadowColor))}`);
  if (el.fade) overrides.push(`\\fad(${Number(el.fade[0] || 0)},${Number(el.fade[1] || 0)})`);

  const escaped = el.karaoke ? karaokeText(el.text, el.duration) : escapeAssText(el.text);
  return {
    layer: el.layer ?? 5,
    start: el.start,
    end: el.end,
    text: `{${overrides.join('')}}${escaped}`,
  };
}

function shadowAlpha(value) {
  return String(value).length === 8 ? String(value).slice(0, 2) : '80';
}

function boxDialogues(el, width, height) {
  if (!el.box?.enabled) return [];
  if (el.name === 'title') return [titleBar(el, width, height)];

  const rect = el.boxRect || textBoxRect(el, width, height);
  const borderWidth = Number(el.box.borderWidth || 0);
  const radius = Number(el.box.radius || 0);
  const alpha = boxAlpha(el.box);
  const boxes = [];
  if (el.box.border && borderWidth > 0) {
    boxes.push(shapeDialogue(el, rect.x, rect.y, rect.width, rect.height, el.box.border, 0, radius, alpha));
  }
  boxes.push(shapeDialogue(
    el,
    rect.x + borderWidth,
    rect.y + borderWidth,
    Math.max(1, rect.width - borderWidth * 2),
    Math.max(1, rect.height - borderWidth * 2),
    el.box.fill || 'FFFFFF',
    1,
    Math.max(0, radius - borderWidth),
    alpha
  ));
  return boxes;
}

function titleBar(el, width, height) {
  const rect = titleBarRect(el, width, height);
  return shapeDialogue(el, rect.x, rect.y, rect.width, rect.height, el.box.fill || '000000', 0, 0, boxAlpha(el.box));
}

function titleBarRect(el, width, height) {
  const fs = fontSize(el.size, height);
  const pad = Number(el.box.pad || 0);
  const border = Number(el.box.borderWidth || 0);
  const boxHeight = Math.max(boxHeightFor(countLines(el.text), fs, pad, border), Math.round(height * 0.07));
  el.textPos = { x: width / 2, y: boxHeight / 2 };
  return { x: 0, y: 0, width, height: boxHeight };
}

export function textBoxRect(el, width, height) {
  const fs = fontSize(el.size, height);
  const pad = Number(el.box.pad || 0);
  const border = Number(el.box.borderWidth || 0);
  const lines = countLines(el.text);
  const marginH = el.marginH || Math.round(width * 0.08);
  const marginV = el.marginV || Math.round(height * 0.045);
  // 顔を避けて左右非対称にした場合はマージンがそのままボックスの左右端になる。
  const asymmetric = el.marginL !== undefined && el.marginR !== undefined
    && (el.marginL !== marginH || el.marginR !== marginH);
  const boxWidth = el.box.width
    || (asymmetric ? Math.round(width - el.marginL - el.marginR) : Math.round(width - marginH * 2));
  const boxHeight = el.box.height || boxHeightFor(lines, fs, pad, border);
  const align = el.align || 'bottom-center';
  let x = marginH;
  let y = height - marginV - boxHeight;

  if (align.includes('top')) y = marginV;
  if (align.includes('middle') || align === 'center') y = Math.round((height - boxHeight) / 2);
  if (align.endsWith('left')) x = marginH;
  if (align.endsWith('right')) x = width - marginH - boxWidth;
  if (align.endsWith('center') || align === 'center') x = Math.round((width - boxWidth) / 2);
  if (asymmetric) x = el.marginL;

  el.textPos = {
    x: x + boxWidth / 2,
    y: y + boxHeight / 2,
  };
  return { x, y, width: boxWidth, height: boxHeight };
}

export function elementRect(el, width, height) {
  if (!el) return null;
  if (el.box?.enabled) {
    return rectForOutput(el.name === 'title' ? titleBarRect(el, width, height) : textBoxRect(el, width, height));
  }
  return elementTextRect(el, width, height);
}

export function elementTextRect(el, width, height) {
  if (!el) return null;
  if (el.box?.enabled && !el.textPos) {
    if (el.name === 'title') {
      titleBarRect(el, width, height);
    } else {
      textBoxRect(el, width, height);
    }
  }

  const fs = fontSize(el.size, height);
  const lines = String(el.text || '').split(/\r?\n|\\N/);
  const textWidth = Math.max(1, Math.round(Math.max(...lines.map((line) => measureWidth(line))) * fs / 0.97));
  const textHeight = Math.max(1, Math.round(lines.length * fs * LINE_HEIGHT));
  const pos = el.textPos || alignedPosition(el.align, width, height, el.marginH, el.marginV);
  const anchor = el.box?.enabled ? ALIGN.center : alignCode(el.align);
  let x = pos.x;
  let y = pos.y;

  if ([8, 5, 2].includes(anchor)) x -= textWidth / 2;
  if ([9, 6, 3].includes(anchor)) x -= textWidth;
  if ([4, 5, 6].includes(anchor)) y -= textHeight / 2;
  if ([1, 2, 3].includes(anchor)) y -= textHeight;

  let rect = { x, y, width: textWidth, height: textHeight };
  if (el.progress?.bar) {
    rect = unionRects(rect, progressBarRect(el, width, height));
  }
  return rectForOutput(rect);
}

// 行ごとの文字矩形を返す。複数行テロップをブロックの外接矩形で扱うと、
// 幅の広い行と、相手に重なる y 帯にある行が別物でも重なったと誤判定する
// （3 行 serif の 2 行目が最も広く、time に近いのは短い 3 行目という実例があった）。
// ASS の中央寄せ（\an5）は行ごとに中央へ寄せるため、行単位の矩形が実際の描画と一致する。
export function elementTextLineRects(el, width, height) {
  const block = elementTextRect(el, width, height);
  if (!block) {
    return [];
  }

  const lines = String(el.text || '').split(/\r?\n|\\N/);
  const fs = fontSize(el.size, height);
  const lineHeight = fs * LINE_HEIGHT;
  // 行送りの余白（LINE_HEIGHT が 1 を超える分）は字が乗らないので、上下から差し引く。
  // これを含めたままだと、上下に並べただけのテロップ（config-mone の title と date）が
  // 字が離れているのに矩形だけ重なって衝突扱いになる。
  const leading = (LINE_HEIGHT - 1) * fs / 2;
  const blockWidth = Math.max(...lines.map((line) => measureWidth(line))) * fs / 0.97;
  const anchor = el.box?.enabled ? ALIGN.center : alignCode(el.align);
  const rects = [];

  for (const [index, line] of lines.entries()) {
    const lineWidth = Math.max(1, Math.round(measureWidth(line) * fs / 0.97));
    let x = block.x;
    if ([8, 5, 2].includes(anchor)) {
      x = block.x + (blockWidth - lineWidth) / 2;
    } else if ([9, 6, 3].includes(anchor)) {
      x = block.x + (blockWidth - lineWidth);
    }
    rects.push(rectForOutput({
      x,
      y: block.y + index * lineHeight + leading,
      width: lineWidth,
      height: Math.max(1, Math.round(lineHeight - leading * 2)),
    }));
  }

  if (el.progress?.bar) {
    rects.push(rectForOutput(progressBarRect(el, width, height)));
  }
  return rects;
}

export function lineBreakViolations(text) {
  const lines = String(text || '').split(/\r?\n|\\N/).filter(Boolean);
  const violations = [];
  for (const [index, line] of lines.entries()) {
    const chars = [...line];
    const head = chars[0];
    const tail = chars.at(-1);
    if (head && LINE_START_KINSOKU_CHARS.has(head)) {
      violations.push({ line: index + 1, side: 'start', char: head });
    }
    if (tail && LINE_END_KINSOKU_CHARS.has(tail)) {
      violations.push({ line: index + 1, side: 'end', char: tail });
    }
  }
  return violations;
}

function shapeDialogue(el, x, y, width, height, fill, layerOffset, radius = 0, alpha = '') {
  const w = Math.round(width);
  const h = Math.round(height);
  const shape = radius > 0 ? roundedRectShape(w, h, radius) : `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
  // \1c はアルファを無視するため、透明度は専用の \1a タグで指定する。
  const alphaTag = alpha ? `\\1a&H${alpha}&` : '';
  return {
    layer: el.boxLayer ?? layerOffset,
    start: el.start,
    end: el.end,
    text: `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\1c${assOverrideColor(fill)}${alphaTag}\\bord0\\shad0}${shape}{\\p0}`,
  };
}

// box.opacity(0=透明〜1=不透明) を ASS のアルファ 2 桁 hex(00=不透明〜FF=透明) に変換する。
// 不透明(未指定 or >=1)のときは空文字を返し、\1a を出力しない（後方互換）。
function boxAlpha(box) {
  const opacity = box?.opacity;
  if (opacity === undefined || opacity === null || Number(opacity) >= 1) {
    return '';
  }
  const aa = Math.max(0, Math.min(255, Math.round((1 - Number(opacity)) * 255)));
  return aa.toString(16).padStart(2, '0').toUpperCase();
}

// 角丸矩形の ASS drawing パス。四隅をベジェ曲線で丸める。
function roundedRectShape(w, h, radius) {
  const r = Math.round(Math.max(0, Math.min(radius, w / 2, h / 2)));
  if (r <= 0) {
    return `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`;
  }
  return [
    `m ${r} 0`,
    `l ${w - r} 0`,
    `b ${w} 0 ${w} 0 ${w} ${r}`,
    `l ${w} ${h - r}`,
    `b ${w} ${h} ${w} ${h} ${w - r} ${h}`,
    `l ${r} ${h}`,
    `b 0 ${h} 0 ${h} 0 ${h - r}`,
    `l 0 ${r}`,
    `b 0 0 0 0 ${r} 0`,
  ].join(' ');
}

function progressBarDialogues(el, width, height) {
  const rect = progressBarRect(el, width, height);
  return [
    shapeDialogue({ ...el, boxLayer: 0 }, rect.x, rect.y, rect.width, rect.height, 'FFFFFF', 0),
    shapeDialogue({ ...el, boxLayer: 1 }, rect.x, rect.y, rect.filled, rect.height, el.color || 'FFFFFF', 1),
  ];
}

function progressBarRect(el, width, height) {
  const totalWidth = Math.round(width * 0.18);
  const filled = Math.max(0, Math.min(totalWidth, Math.round(totalWidth * (el.progress.index / el.progress.total))));
  const barHeight = Math.max(5, Math.round(height * 0.009));
  const pos = alignedPosition(el.align, width, height, el.marginH, el.marginV);
  const y = pos.y + fontSize(el.size, height) * 0.8;
  return { x: pos.x, y, width: totalWidth, height: barHeight, filled };
}

function alignedPosition(align, width, height, marginH = Math.round(width * 0.035), marginV = Math.round(height * 0.045)) {
  const name = align || 'center';
  let x = width / 2;
  let y = height / 2;
  if (name.endsWith('left')) x = marginH;
  if (name.endsWith('right')) x = width - marginH;
  if (name.endsWith('center') || name === 'center') x = width / 2;
  if (name.startsWith('top')) y = marginV;
  if (name.startsWith('bottom')) y = height - marginV;
  if (name.startsWith('middle') || name === 'center') y = height / 2;
  return { x, y };
}

function alignCode(align) {
  return ALIGN[align] || ALIGN.center;
}

export function fontSize(value, height) {
  const numeric = Number(value);
  return Math.max(1, Math.round(numeric > 0 && numeric <= 1 ? height * numeric : numeric));
}

function karaokeText(text, duration) {
  const chars = [...String(text)];
  const visibleChars = chars.filter((ch) => ch !== '\n').length || 1;
  const centiseconds = Math.max(1, Math.round(((duration || 2) * 100) / visibleChars));
  return chars
    .map((ch) => {
      if (ch === '\n') return '\\N';
      return `{\\kf${centiseconds}}${escapeAssText(ch)}`;
    })
    .join('');
}

export function makeTextElement({ name, text, style, width, height, duration, index, total, overrides = {} }) {
  if (!style?.enabled || !text) {
    return null;
  }
  const baseFs = fontSize(style.size, height);
  const defaultMarginH = name === 'serif' ? 0.08 : 0.035;
  const marginH = overrides.marginH ?? Math.round(width * (style.marginH ?? defaultMarginH));
  // marginH と同じく config からも指定できるようにする（schema は以前から marginV を宣言していた）。
  const marginV = overrides.marginV ?? Math.round(height * (style.marginV ?? 0.045));
  // 顔を避けるときだけ左右非対称になる。折り返し幅とボックス幅の両方がこれに従う。
  const marginL = overrides.marginL ?? marginH;
  const marginR = overrides.marginR ?? marginH;
  let fs = baseFs;
  const stripped = stripEmoji(text);
  let wrapped = wrapText(stripped, maxUnitsFor(width, marginL, marginR, fs));

  // 箱高さ上限に収める自動縮小。実際の折り返し結果を測り、収まる最大の整数 fs を選ぶ。
  if (style.autoShrink && style.box?.enabled) {
    const lines = countLines(wrapped);
    if (lines > 1) {
      const minFs = Math.min(baseFs, fontSize(style.minSize ?? 0.05, height));
      const budget = Math.round(height * (style.maxHeight ?? 0.3));
      ({ fs, wrapped } = fitTextToBoxHeight({
        text: stripped,
        width,
        marginL,
        marginR,
        minFs,
        baseFs,
        budget,
        box: style.box,
      }));
    }
  }

  const fade = Array.isArray(style.fade) ? clampFade(style.fade, duration) : undefined;
  const element = {
    name,
    text: wrapped,
    align: style.align,
    size: fs,
    font: style.font,
    color: style.color,
    bold: style.bold,
    shadow: style.shadow,
    shadowColor: '000000',
    fade,
    box: style.box,
    marginH,
    marginV,
    marginL,
    marginR,
    duration,
    karaoke: Boolean(style.karaoke),
    ...overrides,
  };
  if (index !== undefined && total !== undefined) {
    element.progress = { index, total, bar: Boolean(style.bar) };
  }
  return element;
}

function fitTextToBoxHeight({ text, width, marginL, marginR, minFs, baseFs, budget, box }) {
  const pad = Number(box.pad || 0);
  const border = Number(box.borderWidth || 0);
  let lo = minFs;
  let hi = baseFs;
  let bestFs = minFs;
  let bestWrapped = wrapText(text, maxUnitsFor(width, marginL, marginR, minFs));

  while (lo <= hi) {
    const fs = Math.floor((lo + hi) / 2);
    const wrapped = wrapText(text, maxUnitsFor(width, marginL, marginR, fs));
    const boxHeight = boxHeightFor(countLines(wrapped), fs, pad, border);
    if (boxHeight <= budget) {
      bestFs = fs;
      bestWrapped = wrapped;
      lo = fs + 1;
    } else {
      hi = fs - 1;
    }
  }

  return { fs: bestFs, wrapped: bestWrapped };
}

function clampFade(fade, duration) {
  const maxMs = Math.max(0, Math.floor((Number(duration) || 0) * 1000) - 50);
  if (maxMs <= 0) return [0, 0];
  return [Math.min(Number(fade[0] || 0), maxMs), Math.min(Number(fade[1] || 0), maxMs)];
}

function rectForOutput(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
  };
}

function unionRects(a, b) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export { rgbToAssBgr };
