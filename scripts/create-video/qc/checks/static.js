import fs from 'fs';
import path from 'path';
import { videosDir, cacheRoot } from '../../assets.js';
import {
  boxHeightFor,
  countLines,
  elementRect,
  elementTextLineRects,
  elementTextRect,
  fontSize,
  lineBreakViolations,
} from '../../ass.js';
import { buildCardElements } from '../../card.js';
import { buildClipElements } from '../../clip.js';
import { resolveProjectPath } from '../../config.js';
import { buildChapters, buildSummaryEntry, renderCommentList, renderYoutubeDescription } from '../../summary.js';

export function runStaticChecks({ config, clips, size, titleOverride = null }) {
  const results = [];
  results.push(...checkAssets(config, clips));
  results.push(...checkClipMetadata(clips));
  results.push(...checkDuplicates(clips));
  results.push(...checkOrder(config, clips));
  results.push(...checkTelops(config, clips, size, titleOverride));
  results.push(...checkSummaryStatic(config, clips));
  return results;
}

function checkAssets(config, clips) {
  const results = [];
  for (const clip of clips) {
    const sourcePath = clipSourcePath(clip, config);
    if (sourcePath && !fs.existsSync(sourcePath)) {
      results.push(result(
        config.source === 'existing' ? 'error' : 'info',
        'static_clip_missing',
        `${clip.base}.mp4 が見つかりません。`,
        relDetail(sourcePath),
      ));
    }
  }

  const background = config.cards?.background || {};
  if (config.cards?.enabled && background.type === 'video') {
    checkOptionalAsset(results, background.video, 'static_card_background_missing', 'カード背景動画が見つかりません。');
  }
  if (config.cards?.enabled && background.type === 'image') {
    checkOptionalAsset(results, background.image, 'static_card_background_missing', 'カード背景画像が見つかりません。');
  }
  if (config.cards?.enabled && config.cards.se?.enabled) {
    checkOptionalAsset(results, config.cards.se.file, 'static_card_se_missing', 'カード SE が見つかりません。');
  }
  if (config.bgm?.enabled) {
    checkOptionalAsset(results, config.bgm.file, 'static_bgm_missing', 'BGM が見つかりません。');
  }
  for (const kind of ['opening', 'ending']) {
    const video = config.endcaps?.[kind]?.video;
    if (video) {
      checkOptionalAsset(results, video, `static_${kind}_video_missing`, `${kind} 動画が見つかりません。`);
    }
  }
  if (config.fontsDir && !fs.existsSync(resolveProjectPath(config.fontsDir))) {
    results.push(result('warn', 'static_fonts_dir_missing', 'フォントディレクトリが見つかりません。', config.fontsDir));
  }
  return results;
}

function checkClipMetadata(clips) {
  const results = [];
  for (const clip of clips) {
    if (!String(clip.data?.serif || '').trim()) {
      results.push(result('warn', 'static_serif_empty', `${clip.base} の serif が空です。`));
    }
    if (!Array.isArray(clip.categories) || clip.categories.length === 0) {
      results.push(result('warn', 'static_categories_empty', `${clip.base} の categories が空です。`));
    }
    if (!clip.data?.clipUrl) {
      results.push(result('warn', 'static_clip_url_missing', `${clip.base} の clipUrl がありません。`));
    }
  }
  return results;
}

function checkDuplicates(clips) {
  const results = [];
  const seen = new Set();
  for (const clip of clips) {
    if (seen.has(clip.base)) {
      results.push(result('error', 'static_duplicate_clip', `同じクリップ ${clip.base} が 2 回選ばれています。`));
    }
    seen.add(clip.base);
  }
  return results;
}

function checkOrder(config, clips) {
  const order = config.select?.order;
  if (!['date', 'date-desc', 'stream'].includes(order)) {
    return [];
  }
  const expected = [...clips].sort((a, b) => compareForOrder(a, b, order, config.select?.mode));
  if (order === 'date-desc') {
    expected.reverse();
  }
  const same = clips.every((clip, index) => clip.base === expected[index]?.base);
  return same ? [] : [result('error', 'static_order_not_monotonic', `select.order=${order} ですが、クリップ順が単調ではありません。`)];
}

function checkTelops(config, clips, size, titleOverride) {
  const results = [];
  const collisions = [];
  const segments = buildStaticElementSegments({ config, clips, size, titleOverride });
  for (const segment of segments) {
    const rects = [];
    for (const entry of segment.elements) {
      const boxRect = elementRect(entry.element, size.width, size.height);
      const textRect = elementTextRect(entry.element, size.width, size.height);
      if (boxRect && outside(boxRect, size)) {
        results.push(result(
          'error',
          'static_telop_outside',
          `${segment.label} の ${entry.element.name} が画面外にはみ出しています。`,
          rectDetail(boxRect),
        ));
      }
      if (textRect && outside(textRect, size)) {
        results.push(result(
          'error',
          'static_telop_text_outside',
          `${segment.label} の ${entry.element.name} 文字領域が画面外にはみ出しています。`,
          rectDetail(textRect),
        ));
      }
      const occluders = occluderRects(entry.element, size);
      if (occluders.length > 0) {
        rects.push({ name: entry.element.name, rects: occluders });
      }
      results.push(...checkSerifFit(config, entry.element, size, segment.label));
      results.push(...checkKinsoku(entry.element, segment.label));
    }
    collisions.push(...checkCollisions(segment.label, rects, Number(config.qc?.thresholds?.collisionAreaRatio ?? 0.2)));
  }
  results.push(...summarizeCollisions(collisions));
  return results;
}

// 同じテロップ対が同じ位置で重なるのはプリセット由来の 1 つの問題なので、
// クリップごとに並べず 1 件へまとめる（既定プリセットでは time×serif が 19 件中 17 件で出る）。
function summarizeCollisions(collisions) {
  const groups = new Map();
  for (const collision of collisions) {
    const key = `${collision.pair}|${rectDetail(collision.a)}|${rectDetail(collision.b)}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (group.labels.length < 3) {
        group.labels.push(collision.label);
      }
      continue;
    }
    groups.set(key, { ...collision, count: 1, labels: [collision.label] });
  }

  return [...groups.values()].map((group) => {
    const where = group.count === 1
      ? group.labels[0]
      : `${group.count} 箇所（${group.labels.join(' / ')}${group.count > group.labels.length ? ' ほか' : ''}）`;
    return result(
      'error',
      'static_telop_collision',
      `${group.pair} が重なっています: ${where}`,
      `重なり ${(group.ratio * 100).toFixed(0)}% / ${rectDetail(group.a)} / ${rectDetail(group.b)}`,
    );
  });
}

function buildStaticElementSegments({ config, clips, size, titleOverride }) {
  const segments = [];
  const total = clips.length;
  const openingDuration = Number(config.endcaps?.opening?.duration) || 3;
  if (config.endcaps?.opening?.enabled && !config.endcaps.opening.video) {
    segments.push({
      label: 'opening',
      elements: buildCardElements({
        kind: 'opening',
        clips,
        index: 0,
        total,
        config,
        size,
        title: titleOverride || null,
        duration: openingDuration,
      }).map((element) => ({ element })),
    });
  }

  for (const [index, clip] of clips.entries()) {
    if (config.cards?.enabled) {
      segments.push({
        label: `${clip.base} のカード`,
        elements: buildCardElements({
          kind: 'clip',
          clip,
          index,
          total,
          config,
          size,
          duration: Number(config.cards.duration) || 1.5,
        }).map((element) => ({ element })),
      });
    }
    segments.push({
      label: clip.base,
      elements: buildClipElements({
        clip,
        index,
        total,
        config,
        size,
        titleOverride,
      }).map((element) => ({ element })),
    });
  }

  const endingDuration = Number(config.endcaps?.ending?.duration) || 4;
  if (config.endcaps?.ending?.enabled && !config.endcaps.ending.video) {
    segments.push({
      label: 'ending',
      elements: buildCardElements({
        kind: 'ending',
        clips,
        index: Math.max(0, clips.length - 1),
        total,
        config,
        size,
        duration: endingDuration,
      }).map((element) => ({ element })),
    });
  }
  return segments;
}

function checkSerifFit(config, element, size, label) {
  if (element.name !== 'serif') {
    return [];
  }
  const results = [];
  const maxLines = Number(config.qc?.static?.maxSerifLines ?? 4);
  const lines = countLines(element.text);
  if (lines > maxLines) {
    results.push(result('warn', 'static_serif_lines', `${label} の serif が ${lines} 行です（上限 ${maxLines} 行）。`));
  }

  const style = config.telops?.serif || {};
  if (style.autoShrink && style.box?.enabled) {
    const baseFs = fontSize(style.size, size.height);
    const minFs = Math.min(baseFs, fontSize(style.minSize ?? 0.05, size.height));
    const pad = Number(style.box.pad || 0);
    const border = Number(style.box.borderWidth || 0);
    const budget = Math.round(size.height * (style.maxHeight ?? 0.3));
    const actualHeight = boxHeightFor(lines, element.size, pad, border);
    if (element.size <= minFs && actualHeight > budget) {
      results.push(result(
        'warn',
        'static_serif_min_size',
        `${label} の serif は autoShrink が minSize に張り付いています。`,
        `boxHeight=${actualHeight}px / budget=${budget}px / fontSize=${element.size}px`,
      ));
    }
  }
  return results;
}

function checkKinsoku(element, label) {
  const violations = lineBreakViolations(element.text);
  if (violations.length === 0) {
    return [];
  }
  return [result(
    'warn',
    'static_kinsoku_violation',
    `${label} の ${element.name} に禁則違反が残っています。`,
    violations.map((v) => `${v.line}行目${v.side === 'start' ? '行頭' : '行末'}「${v.char}」`).join(' / '),
  )];
}

// 画面上で他のテロップを実際に隠すのは「不透明なボックス」なので、ボックスがあればそれを、
// 無ければ行ごとの文字矩形を遮蔽領域とする。
// ただし title のボックスは全幅の背景バーで、date と progress はその上に乗るのが意図的な
// デザインなので（実フレームで確認済み）、title だけは文字矩形で見る。
function occluderRects(element, size) {
  if (element.box?.enabled && element.name !== 'title') {
    const box = elementRect(element, size.width, size.height);
    return box ? [box] : [];
  }
  return elementTextLineRects(element, size.width, size.height);
}

// 文字矩形は charWidth の推定幅で作るため実測より広く、端が数 px 触れることがある
// （既定プリセットの 1 行タイトルと date は面積比 3% で接触するが、実フレームでは重なっていない）。
// 一方 2 行タイトルが date を覆う実害は面積比 77% になるので、重なり面積比で切り分ける。
function checkCollisions(label, rects, minAreaRatio) {
  const collisions = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const worst = worstOverlap(a.rects, b.rects);
      if (worst.ratio >= minAreaRatio) {
        collisions.push({
          label,
          pair: `${a.name} と ${b.name}`,
          ratio: worst.ratio,
          a: worst.a,
          b: worst.b,
        });
      }
    }
  }
  return collisions;
}

// 行どうしの総当たりで、最も深く重なっている組を返す。
function worstOverlap(as, bs) {
  let worst = { ratio: 0, a: as[0], b: bs[0] };
  for (const a of as) {
    for (const b of bs) {
      const ratio = overlapAreaRatio(a, b);
      if (ratio > worst.ratio) {
        worst = { ratio, a, b };
      }
    }
  }
  return worst;
}

// 小さい方の矩形に対する重なり面積の比を返す。
export function overlapAreaRatio(a, b) {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) {
    return 0;
  }
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? (width * height) / smaller : 0;
}

function checkSummaryStatic(config, clips) {
  if (config.summary?.enabled === false) {
    return [];
  }
  const results = [];
  const entries = staticSummaryEntries(config, clips);
  const totalSec = staticTotalSec(config, clips);
  const chapterOptions = config.summary?.chapters || {};
  if (chapterOptions.enabled !== false) {
    const { chapters } = buildChapters(entries, totalSec, chapterOptions);
    if (chapters.length > 0 && chapters[0].sec !== 0) {
      results.push(result('warn', 'static_chapter_start', 'チャプターの先頭が 0:00 ではありません。'));
    }
    if (chapters.length > 0 && chapters.length < 3) {
      results.push(result('warn', 'static_chapter_count', `チャプターが ${chapters.length} 個しかありません。`));
    }
    for (let i = 0; i + 1 < chapters.length; i++) {
      const duration = chapters[i + 1].sec - chapters[i].sec;
      if (duration < 10) {
        results.push(result('warn', 'static_chapter_duration', `${chapters[i].time} のチャプターが ${duration} 秒です。`));
      }
    }
  }

  const maxChars = Number(config.summary?.maxChars ?? 5000);
  if (maxChars > 0) {
    const youtube = renderYoutubeDescription({ chapters: [], sources: [], summary: config.summary || {} });
    if (youtube.length > maxChars) {
      results.push(result('warn', 'static_youtube_description_length', `概要欄の固定文だけで ${youtube.length} 文字あります（上限 ${maxChars}）。`));
    }
    for (const [index, chunk] of renderCommentList(entries, maxChars).entries()) {
      if (chunk.length > maxChars) {
        results.push(result('warn', 'static_comment_length', `固定コメント ${index + 1} が ${chunk.length} 文字です（上限 ${maxChars}）。`));
      }
    }
  }
  return results;
}

function staticSummaryEntries(config, clips) {
  let timelineSec = config.endcaps?.opening?.enabled ? Number(config.endcaps.opening.duration) || 0 : 0;
  const entries = [];
  for (const clip of clips) {
    entries.push(buildSummaryEntry(clip, timelineSec));
    if (config.cards?.enabled) {
      timelineSec += Number(config.cards.duration) || 0;
    }
    timelineSec += clipDuration(clip);
  }
  return entries;
}

function staticTotalSec(config, clips) {
  let total = config.endcaps?.opening?.enabled ? Number(config.endcaps.opening.duration) || 0 : 0;
  total += clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  if (config.cards?.enabled) {
    total += clips.length * (Number(config.cards.duration) || 0);
  }
  if (config.endcaps?.ending?.enabled) {
    total += Number(config.endcaps.ending.duration) || 0;
  }
  return total;
}

function clipDuration(clip) {
  const duration = Number(clip.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }
  return Math.max(0.1, Number(clip.endTime) - Number(clip.startTime));
}

function clipSourcePath(clip, config) {
  if (config.source === 'cache') {
    return path.join(cacheRoot, clip.videoId, `${clip.base}.mp4`);
  }
  return path.join(videosDir, `${clip.base}.mp4`);
}

function checkOptionalAsset(results, assetPath, code, message) {
  if (!assetPath) {
    return;
  }
  const resolved = resolveProjectPath(assetPath);
  if (!fs.existsSync(resolved)) {
    results.push(result('warn', code, message, relDetail(resolved)));
  }
}

function outside(rect, size) {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > size.width || rect.y + rect.h > size.height;
}

function compareForOrder(a, b, order, mode) {
  if (mode === 'videoId' && order === 'date') {
    return compare(a.startTime, b.startTime) || compare(a.file, b.file);
  }
  if (order === 'stream') {
    return compare(a.uploadDate, b.uploadDate) || compare(a.videoId, b.videoId) || compare(a.startTime, b.startTime) || compare(a.file, b.file);
  }
  return compare(a.uploadDate, b.uploadDate) || compare(a.startTime, b.startTime) || compare(a.file, b.file);
}

function compare(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function rectDetail(rect) {
  return `x=${rect.x}, y=${rect.y}, w=${rect.w}, h=${rect.h}`;
}

function relDetail(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

function result(level, code, message, detail = null) {
  return { level, code, message, ...(detail ? { detail } : {}) };
}
