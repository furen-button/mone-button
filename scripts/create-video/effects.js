import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { cacheRoot } from './assets.js';
import { resolveProjectPath } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(__filename);
const cascadeUrl = 'https://raw.githubusercontent.com/nagadomi/lbpcascade_animeface/master/lbpcascade_animeface.xml';
const cv2Availability = new Map();
let warnedCv2 = false;
let warnedCascade = false;

export function analyzeLoudness({ ffmpeg, sourceMp4, analysis }) {
  const windowSec = positiveNumber(analysis?.window, 0.1);
  const samples = Math.max(1, Math.round(44100 * windowSec));
  const audioFilter = [
    'aresample=44100',
    `asetnsamples=n=${samples}`,
    'astats=metadata=1:reset=1',
    'ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-',
  ].join(',');

  try {
    const out = execFileSync(ffmpeg, [
      '-hide_banner',
      '-v', 'error',
      '-i', sourceMp4,
      '-vn',
      '-af', audioFilter,
      '-f', 'null',
      '-',
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const parsed = parseLoudnessOutput(out, windowSec);
    return parsed.times.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function resolveFocus({ tools, config, sourceMp4, zoomStart, size, workDir, override }) {
  const manual = normalizedPoint(override);
  if (manual) {
    return { ...manual, source: '手動' };
  }

  const focus = config.focus || {};
  if (focus.mode === 'center') {
    return { x: 0.5, y: 0.5, source: '中央' };
  }

  if (focus.mode === 'face') {
    const face = await detectFaceFocus({ tools, focus, sourceMp4, zoomStart, size, workDir });
    if (face) {
      return face;
    }
  }

  const fixed = normalizedPoint(focus);
  if (fixed) {
    return { ...fixed, source: '固定', note: focus.mode === 'face' ? '顔未検出' : null };
  }
  return { x: 0.5, y: 0.5, source: '中央', note: focus.mode === 'face' ? '顔未検出' : null };
}

export async function planZoom({ tools, clip, sourceMp4, config, size, workDir }) {
  const zoomConfig = config.effects?.zoom;
  const override = clip.data?.effects?.zoom;
  const hasOverride = override !== undefined;
  const killSwitch = config.__meta?.cli?.zoom === false;

  if (killSwitch) {
    return hasOverride ? { skip: '--no-zoom 指定' } : null;
  }
  if (!zoomConfig?.enabled && !hasOverride) {
    return null;
  }
  if (override === false) {
    return { skip: '手動OFF' };
  }

  const duration = clipDuration(clip);
  const manual = isPlainObject(override) ? override : {};
  const scale = clampNumber(manual.scale ?? zoomConfig.scale, 1.01, 3);
  const manualAt = finiteNumber(manual.at);
  const forced = override === true;
  const mode = zoomMode(manual.mode)
    ?? (manualAt !== null ? 'punch' : zoomMode(zoomConfig.mode))
    ?? 'punch';

  if (mode === 'full') {
    const focus = await resolveFocus({
      tools,
      config: zoomConfig,
      sourceMp4,
      zoomStart: 0,
      size,
      workDir,
      override: manual,
    });
    return { at: 0, scale, focus, origin: manual.mode === 'full' ? '手動' : '自動', mode };
  }

  if (manualAt !== null) {
    const at = roundToFps(clamp(manualAt, 0, Math.max(0, duration - 0.2)), size.fps);
    const focus = await resolveFocus({
      tools,
      config: zoomConfig,
      sourceMp4,
      zoomStart: at,
      size,
      workDir,
      override: manual,
    });
    return { at, scale, focus, origin: '手動', mode };
  }

  const loudness = analyzeLoudness({ ffmpeg: tools.ffmpeg, sourceMp4, analysis: zoomConfig.analysis });
  if (!loudness) {
    return { skip: '音声解析失敗' };
  }

  const actualDuration = positiveNumber(loudness.duration, duration);
  const minDuration = positiveNumber(zoomConfig.minDuration, 2.0);
  if (!forced && actualDuration < minDuration) {
    return { skip: `クリップが短い: ${actualDuration.toFixed(1)}s < ${minDuration.toFixed(1)}s` };
  }

  const silenceFloor = numberWithDefault(zoomConfig.analysis?.silenceFloor, -60.0);
  if (loudness.rms.every((value) => value <= silenceFloor)) {
    return { skip: '無音' };
  }

  const smooth = movingAverage(loudness.rms, Math.max(1, Math.round(numberWithDefault(zoomConfig.analysis?.smooth, 3))));
  const peak = maxIndex(smooth);
  const peakDb = smooth[peak];
  const prominence = peakDb - median(smooth);
  const minProminence = numberWithDefault(zoomConfig.analysis?.minProminence, 3.0);
  if (!forced && prominence < minProminence) {
    return { skip: '音量が平坦' };
  }

  const lead = Math.max(0, numberWithDefault(zoomConfig.lead, 0.15));
  const minStart = Math.max(0, numberWithDefault(zoomConfig.minStart, 0.3));
  const minZoomDuration = Math.max(0.2, numberWithDefault(zoomConfig.minZoomDuration, 0.8));
  const latestStart = actualDuration - minZoomDuration;
  if (latestStart < minStart) {
    return { skip: 'ズーム区間が短い' };
  }

  const rawStart = loudness.times[peak] - lead;
  const at = roundToFps(clamp(rawStart, minStart, latestStart), size.fps);
  const focus = await resolveFocus({
    tools,
    config: zoomConfig,
    sourceMp4,
    zoomStart: at,
    size,
    workDir,
    override: manual,
  });
  return { at, scale, focus, origin: '自動', peakDb, mode };
}

export function buildZoomFilterComplex({ baseFilters, subFilter, zoom, size, upscale = null }) {
  const base = baseFilters.join(',');
  const crop = zoomCropFilters({ zoom, size, upscale }).join(',');
  const at = formatSeconds(zoom.at);
  const subtitle = subFilter ? `[zv]${subFilter}[v]` : '[zv]null[v]';
  return [
    `[0:v]${base},split=2[pre][post]`,
    `[pre]trim=end=${at},setpts=PTS-STARTPTS[zin]`,
    `[post]trim=start=${at},setpts=PTS-STARTPTS,${crop}[zout]`,
    '[zin][zout]concat=n=2:v=1:a=0[zv]',
    subtitle,
  ].join(';');
}

// upscale を渡すと切り出し後の拡大フィルタを差し替える（effects.enhance の Anime4K CNN 拡大）。未指定なら従来の lanczos。
export function zoomCropFilters({ zoom, size, upscale = null }) {
  const { cropWidth, cropHeight, cropX, cropY } = zoomCropRect({ zoom, size });
  return [
    `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`,
    upscale || `scale=${size.width}:${size.height}:flags=lanczos`,
    'setsar=1',
  ];
}

// ズームで切り出す矩形（scale+pad 済みフレーム上の px）。フィルタ文字列と顔矩形の座標変換で共有する。
export function zoomCropRect({ zoom, size }) {
  const scale = Math.max(1.01, Number(zoom.scale) || 1.3);
  const cropWidth = even(Math.max(2, size.width / scale));
  const cropHeight = even(Math.max(2, size.height / scale));
  const rawX = Math.round(zoom.focus.x * size.width - cropWidth / 2);
  const rawY = Math.round(zoom.focus.y * size.height - cropHeight / 2);
  const cropX = evenFloor(clamp(rawX, 0, size.width - cropWidth));
  const cropY = evenFloor(clamp(rawY, 0, size.height - cropHeight));
  return { cropWidth, cropHeight, cropX, cropY };
}

// scale+pad 済みフレーム上の矩形を、ズーム後の出力座標へ写す。画面外にはみ出す分は切り落とす。
export function transformRectThroughZoom(rect, { zoom, size }) {
  const { cropWidth, cropHeight, cropX, cropY } = zoomCropRect({ zoom, size });
  const sx = size.width / cropWidth;
  const sy = size.height / cropHeight;
  const x0 = clamp((rect.x - cropX) * sx, 0, size.width);
  const y0 = clamp((rect.y - cropY) * sy, 0, size.height);
  const x1 = clamp((rect.x + rect.w - cropX) * sx, 0, size.width);
  const y1 = clamp((rect.y + rect.h - cropY) * sy, 0, size.height);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

// 指定時刻のフレームから最大の顔を 1 つずつ拾い、scale+pad 済み出力座標の矩形（px）で返す。
// cv2 やモデルが無い、顔が無いときは空配列。ズームの焦点検出と同じ検出器を使う。
export async function detectFaceRects({ tools, focus, sourceMp4, size, workDir, times }) {
  const python = String(focus?.python || 'python3');
  if (!hasCv2(python)) {
    warnCv2();
    return [];
  }
  const cascade = await ensureCascade(focus?.cascade);
  if (!cascade) {
    return [];
  }
  const framePaths = extractPaddedFrames({ ffmpeg: tools.ffmpeg, sourceMp4, times, size, workDir, subdir: 'face-rects' });
  if (framePaths.length === 0) {
    return [];
  }
  try {
    const scriptPath = path.join(moduleDir, 'detect_anime_face.py');
    const out = execFileSync(python, [scriptPath, '--cascade', cascade, ...framePaths], { encoding: 'utf8' });
    return largestFaces(JSON.parse(out));
  } catch (err) {
    if (err.status === 2) {
      warnCv2();
    }
    return [];
  }
}

function largestFaces(detections) {
  const rects = [];
  for (const item of detections) {
    const faces = Array.isArray(item.faces) ? item.faces : [];
    const face = faces
      .map((entry) => ({ x: Number(entry.x), y: Number(entry.y), w: Number(entry.w), h: Number(entry.h) }))
      .filter((entry) => [entry.x, entry.y, entry.w, entry.h].every(Number.isFinite) && entry.w > 0 && entry.h > 0)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (face) {
      rects.push(face);
    }
  }
  return rects;
}

function parseLoudnessOutput(out, windowSec) {
  const times = [];
  const rms = [];
  let currentTime = null;
  for (const line of out.split(/\r?\n/)) {
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (timeMatch) {
      currentTime = Number(timeMatch[1]);
    }
    const rmsMatch = line.match(/RMS_level=([^\s]+)/);
    if (rmsMatch && currentTime !== null) {
      times.push(currentTime);
      rms.push(parseRms(rmsMatch[1]));
      currentTime = null;
    }
  }
  return { times, rms, duration: times.at(-1) + windowSec };
}

function zoomMode(value) {
  return value === 'punch' || value === 'full' ? value : null;
}

function parseRms(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -120;
}

async function detectFaceFocus({ tools, focus, sourceMp4, zoomStart, size, workDir }) {
  const python = String(focus.python || 'python3');
  if (!hasCv2(python)) {
    warnCv2();
    return null;
  }

  const cascade = await ensureCascade(focus.cascade);
  if (!cascade) {
    return null;
  }

  const framePaths = extractFocusFrames({ ffmpeg: tools.ffmpeg, sourceMp4, zoomStart, size, workDir, frames: focus.frames });
  if (framePaths.length === 0) {
    return null;
  }

  try {
    const scriptPath = path.join(moduleDir, 'detect_anime_face.py');
    const out = execFileSync(python, [scriptPath, '--cascade', cascade, ...framePaths], { encoding: 'utf8' });
    const detections = JSON.parse(out);
    const points = faceCenters(detections, size);
    if (points.length === 0) {
      return null;
    }
    return {
      x: median(points.map((point) => point.x)),
      y: median(points.map((point) => point.y)),
      source: '顔',
    };
  } catch (err) {
    if (err.status === 2) {
      warnCv2();
    }
    return null;
  }
}

function hasCv2(python) {
  if (cv2Availability.has(python)) {
    return cv2Availability.get(python);
  }
  try {
    execFileSync(python, [
      '-c',
      [
        'import cv2',
        'import sys',
        'sys.exit(0 if hasattr(cv2, "CascadeClassifier") else 2)',
      ].join(';'),
    ], { stdio: 'ignore' });
    cv2Availability.set(python, true);
    return true;
  } catch {
    cv2Availability.set(python, false);
    return false;
  }
}

function warnCv2() {
  if (warnedCv2) {
    return;
  }
  console.warn('⚠️ opencv-python-headless<5 が必要なため顔検出をスキップします（pip install "opencv-python-headless<5"）。');
  warnedCv2 = true;
}

async function ensureCascade(configuredPath) {
  const cascadePath = configuredPath
    ? resolveProjectPath(configuredPath)
    : path.join(cacheRoot, 'models', 'lbpcascade_animeface.xml');
  if (fs.existsSync(cascadePath)) {
    return cascadePath;
  }

  try {
    fs.mkdirSync(path.dirname(cascadePath), { recursive: true });
    const response = await fetch(cascadeUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error('empty response');
    }
    fs.writeFileSync(cascadePath, bytes);
    return cascadePath;
  } catch (err) {
    if (!warnedCascade) {
      console.warn(`⚠️ 顔検出モデルを取得できないため顔検出をスキップします: ${err.message}`);
      warnedCascade = true;
    }
    return null;
  }
}

function extractFocusFrames({ ffmpeg, sourceMp4, zoomStart, size, workDir, frames }) {
  const count = Math.max(1, Math.round(Number(frames) || 3));
  const times = Array.from({ length: count }, (_, i) => Math.max(0, zoomStart + 0.1 + i * 0.3));
  return extractPaddedFrames({ ffmpeg, sourceMp4, times, size, workDir, subdir: 'zoom-focus' });
}

// 出力と同じ scale+pad を掛けたフレームを指定時刻で抜く。顔検出はこの座標系で行う。
function extractPaddedFrames({ ffmpeg, sourceMp4, times, size, workDir, subdir }) {
  const frameDir = path.join(workDir, subdir);
  fs.mkdirSync(frameDir, { recursive: true });
  const out = [];
  for (const [i, at] of times.entries()) {
    const outPath = path.join(frameDir, `${safeBaseName(sourceMp4)}-${Math.round(at * 1000)}-${i}.png`);
    try {
      execFileSync(ffmpeg, [
        '-y',
        '-hide_banner',
        '-v', 'error',
        '-i', sourceMp4,
        '-ss', formatSeconds(at),
        '-vf', [
          `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
          `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
          'setsar=1',
        ].join(','),
        '-frames:v', '1',
        outPath,
      ], { stdio: 'ignore' });
      if (fs.existsSync(outPath)) {
        out.push(outPath);
      }
    } catch {
      // フレーム抽出に失敗したフレームだけ捨て、固定位置フォールバックへ進む。
    }
  }
  return out;
}

function faceCenters(detections, size) {
  const points = [];
  for (const item of detections) {
    const faces = Array.isArray(item.faces) ? item.faces : [];
    const face = faces
      .map((entry) => ({ ...entry, area: Number(entry.w) * Number(entry.h) }))
      .filter((entry) => Number.isFinite(entry.area) && entry.area > 0)
      .sort((a, b) => b.area - a.area)[0];
    if (face) {
      points.push({
        x: clamp((Number(face.x) + Number(face.w) / 2) / size.width, 0, 1),
        y: clamp((Number(face.y) + Number(face.h) / 2) / size.height, 0, 1),
      });
    }
  }
  return points;
}

function movingAverage(values, window) {
  const radius = Math.floor(window / 2);
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - radius); i <= Math.min(values.length - 1, index + radius); i++) {
      sum += values[i];
      count++;
    }
    return sum / count;
  });
}

function maxIndex(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) {
      best = i;
    }
  }
  return best;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizedPoint(value) {
  const x = finiteNumber(value?.x);
  const y = finiteNumber(value?.y);
  if (x === null || y === null) {
    return null;
  }
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

function clipDuration(clip) {
  const duration = finiteNumber(clip.duration);
  if (duration !== null && duration > 0) {
    return duration;
  }
  return Math.max(0.1, Number(clip.endTime) - Number(clip.startTime));
}

function roundToFps(value, fps) {
  const rate = positiveNumber(fps, 30);
  return Math.round(value * rate) / rate;
}

function formatSeconds(value) {
  return Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function clampNumber(value, min, max) {
  return clamp(numberWithDefault(value, min), min, max);
}

function numberWithDefault(value, fallback) {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : parsed;
}

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function even(value) {
  return Math.max(0, Math.round(value / 2) * 2);
}

function evenFloor(value) {
  return Math.max(0, Math.floor(value / 2) * 2);
}

function safeBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
