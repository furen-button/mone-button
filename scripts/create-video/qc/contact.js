import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveProjectPath } from '../config.js';

// 各クリップの代表フレームを 1 枚のグリッドへ並べる。
// 決定論的な検査が拾えない「絵の内容・間・読みやすさ」を人が一目で見るためのもので、
// LLM 目視レビュー（review.js）の入力にもなる。
export function buildContactSheet({ tools, videoPath, manifest, config, outPath, workDir, includeCards = false }) {
  if (!manifest) {
    return { skipped: 'manifest が無いため代表フレームの時刻が分かりません。' };
  }

  const segments = (manifest.segments || [])
    .filter((segment) => includeCards || segment.kind === 'clip');
  if (segments.length === 0) {
    return { skipped: '対象セグメントがありません。' };
  }

  const options = config.qc?.contact || {};
  const cellWidth = even(Number(options.cellWidth ?? 480));
  const columns = Math.max(1, Number(options.columns ?? 4));
  const fontFile = resolveFontFile(options);
  const frameDir = path.join(workDir, 'qc-contact');
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });

  const cells = [];
  for (const [index, segment] of segments.entries()) {
    const framePath = path.join(frameDir, `${String(index).padStart(3, '0')}.png`);
    const at = frameTimeFor(segment);
    const label = `#${index + 1}  ${formatClock(segment.atSec)}`;
    if (!extractCell({ ffmpeg: tools.ffmpeg, videoPath, at, framePath, cellWidth, label, fontFile })) {
      continue;
    }
    cells.push({ index: index + 1, base: segment.base, atSec: segment.atSec, at, framePath });
  }

  if (cells.length === 0) {
    return { skipped: '代表フレームを抽出できませんでした。' };
  }

  const rows = Math.ceil(cells.length / columns);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  try {
    execFileSync(tools.ffmpeg, [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-pattern_type', 'glob',
      '-i', path.join(frameDir, '*.png'),
      // 端数のマスは背景色で埋める。init_padding を使わないのは古い ffmpeg でも通すため。
      '-vf', `tile=${columns}x${rows}:padding=4:margin=4:color=0x1A1A1A`,
      '-frames:v', '1',
      outPath,
    ], { stdio: 'pipe' });
  } catch (err) {
    return { skipped: `コンタクトシートの合成に失敗しました: ${firstLine(err.stderr)}` };
  }

  return { outPath, cells, columns, rows };
}

// クリップの中央付近を代表フレームにする。テロップのフェードを避けるため端は使わない。
function frameTimeFor(segment) {
  const start = Number(segment.atSec) || 0;
  const duration = Number(segment.durationSec) || 0;
  return start + Math.max(0.2, Math.min(duration / 2, duration - 0.2));
}

function extractCell({ ffmpeg, videoPath, at, framePath, cellWidth, label, fontFile }) {
  const filters = [`scale=${cellWidth}:-2`];
  if (fontFile) {
    filters.push([
      'drawtext=',
      `fontfile=${quoteFilterValue(fontFile)}`,
      `:text=${quoteFilterValue(label)}`,
      ':fontsize=18:fontcolor=white:box=1:boxcolor=0x000000@0.75:boxborderw=6:x=8:y=8',
    ].join(''));
  }
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-ss', at.toFixed(3),
      '-i', videoPath,
      '-vf', filters.join(','),
      '-frames:v', '1',
      framePath,
    ], { stdio: 'pipe' });
    return fs.existsSync(framePath);
  } catch {
    return false;
  }
}

// drawtext のラベル用フォント。無ければラベルなしで続行する。
function resolveFontFile(options) {
  const candidates = [
    options.fontFile,
    '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = resolveProjectPath(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

export function contactSheetPathFor(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${base}.contact.png`);
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

// ffmpeg のフィルタ引数。引用符で囲んだうえで、フィルタグラフ側の区切りである
// `:` と、引用符自身・バックスラッシュをエスケープする（引用符だけでは `:` で切られる）。
function quoteFilterValue(value) {
  return `'${String(value).replace(/([\\'])/gu, '\\$1').replace(/:/gu, '\\:')}'`;
}

function even(value) {
  const rounded = Math.max(80, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).find(Boolean) || '詳細なし';
}
