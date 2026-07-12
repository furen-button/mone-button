import { ALIGN, assOverrideColor, rgbToAssBgr } from './config.js';

export function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr || '';
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
  if (!text) return '';
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[️‍\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (c <= 0x2ff) return 0.5;
  if (c >= 0xff61 && c <= 0xff9f) return 0.5;
  return 1;
}

export function wrapText(text, maxUnits) {
  if (maxUnits <= 0) return text;
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

  for (const ch of String(text)) {
    if (ch === '\n') {
      flush();
      continue;
    }
    line += ch;
    width += charWidth(ch);
    if (ch === ' ') lastSpace = line.length - 1;
    if (width >= maxUnits) {
      if (lastSpace > 0 && lastSpace < line.length - 1) {
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
  return out.join('\n');
}

export function maxUnitsFor(width, marginL, marginR, size) {
  return Math.floor(((width - marginL - marginR) / size) * 0.97);
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
  const boxes = [];
  if (el.box.border && borderWidth > 0) {
    boxes.push(shapeDialogue(el, rect.x, rect.y, rect.width, rect.height, el.box.border, 0));
  }
  boxes.push(shapeDialogue(
    el,
    rect.x + borderWidth,
    rect.y + borderWidth,
    Math.max(1, rect.width - borderWidth * 2),
    Math.max(1, rect.height - borderWidth * 2),
    el.box.fill || 'FFFFFF',
    1
  ));
  return boxes;
}

function titleBar(el, width, height) {
  const fs = fontSize(el.size, height);
  const pad = Number(el.box.pad || 0);
  const boxHeight = Math.max(fs + pad * 2, Math.round(height * 0.07));
  el.textPos = { x: width / 2, y: boxHeight / 2 };
  return shapeDialogue(el, 0, 0, width, boxHeight, el.box.fill || '000000', 0);
}

function textBoxRect(el, width, height) {
  const fs = fontSize(el.size, height);
  const pad = Number(el.box.pad || 0);
  const border = Number(el.box.borderWidth || 0);
  const lines = String(el.text || '').split(/\r?\n|\\N/).length;
  const boxWidth = el.box.width || Math.round(width - (el.marginH || Math.round(width * 0.08)) * 2);
  const boxHeight = el.box.height || Math.round(lines * fs * 1.25 + pad * 2 + border * 2);
  const align = el.align || 'bottom-center';
  const marginH = el.marginH || Math.round(width * 0.08);
  const marginV = el.marginV || Math.round(height * 0.045);
  let x = marginH;
  let y = height - marginV - boxHeight;

  if (align.includes('top')) y = marginV;
  if (align.includes('middle') || align === 'center') y = Math.round((height - boxHeight) / 2);
  if (align.endsWith('left')) x = marginH;
  if (align.endsWith('right')) x = width - marginH - boxWidth;
  if (align.endsWith('center') || align === 'center') x = Math.round((width - boxWidth) / 2);

  el.textPos = {
    x: x + boxWidth / 2,
    y: y + boxHeight / 2,
  };
  return { x, y, width: boxWidth, height: boxHeight };
}

function shapeDialogue(el, x, y, width, height, fill, layerOffset) {
  const shape = `m 0 0 l ${Math.round(width)} 0 ${Math.round(width)} ${Math.round(height)} 0 ${Math.round(height)}`;
  return {
    layer: el.boxLayer ?? layerOffset,
    start: el.start,
    end: el.end,
    text: `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\1c${assOverrideColor(fill)}\\bord0\\shad0}${shape}{\\p0}`,
  };
}

function progressBarDialogues(el, width, height) {
  const totalWidth = Math.round(width * 0.18);
  const filled = Math.max(0, Math.min(totalWidth, Math.round(totalWidth * (el.progress.index / el.progress.total))));
  const barHeight = Math.max(5, Math.round(height * 0.009));
  const pos = alignedPosition(el.align, width, height, el.marginH, el.marginV);
  const y = pos.y + fontSize(el.size, height) * 0.8;
  return [
    shapeDialogue({ ...el, boxLayer: 0 }, pos.x, y, totalWidth, barHeight, 'FFFFFF', 0),
    shapeDialogue({ ...el, boxLayer: 1 }, pos.x, y, filled, barHeight, el.color || 'FFFFFF', 1),
  ];
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

function fontSize(value, height) {
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
  if (!style?.enabled || !text) return null;
  const fs = fontSize(style.size, height);
  const marginH = overrides.marginH ?? Math.round(width * (name === 'serif' ? 0.08 : 0.035));
  const marginV = overrides.marginV ?? Math.round(height * 0.045);
  const wrapped = wrapText(stripEmoji(text), maxUnitsFor(width, marginH, marginH, fs));
  const fade = Array.isArray(style.fade) ? clampFade(style.fade, duration) : undefined;
  const element = {
    name,
    text: wrapped,
    align: style.align,
    size: style.size,
    color: style.color,
    bold: style.bold,
    shadow: style.shadow,
    shadowColor: '000000',
    fade,
    box: style.box,
    marginH,
    marginV,
    duration,
    karaoke: Boolean(style.karaoke),
    ...overrides,
  };
  if (index !== undefined && total !== undefined) {
    element.progress = { index, total, bar: Boolean(style.bar) };
  }
  return element;
}

function clampFade(fade, duration) {
  const maxMs = Math.max(0, Math.floor((Number(duration) || 0) * 1000) - 50);
  if (maxMs <= 0) return [0, 0];
  return [Math.min(Number(fade[0] || 0), maxMs), Math.min(Number(fade[1] || 0), maxMs)];
}

export { rgbToAssBgr };
