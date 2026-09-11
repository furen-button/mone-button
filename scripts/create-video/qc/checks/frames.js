import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(__filename);

export function runFrameLogChecks({ scanLog, manifest, config }) {
  return [
    ...checkBlackDetect({ intervals: parseBlackDetect(scanLog), manifest, config }),
    ...checkFreezeDetect({ intervals: parseFreezeDetect(scanLog), manifest, config }),
  ];
}

export function runTelopFillChecks({ tools, videoPath, manifest, config, workDir }) {
  if (!manifest) {
    return [result('info', 'frames_telop_fill_skip', 'manifest が無いためテロップ焼き込み検査をスキップします。')];
  }
  const python = String(config.qc.python || 'python3');
  if (!hasCv2(python)) {
    return [result('info', 'frames_telop_fill_cv2_skip', 'cv2 が無いためテロップ焼き込み検査をスキップします。')];
  }

  const results = [];
  const threshold = Number(config.qc.thresholds.telopFillRatio);
  const distance = Number(config.qc.thresholds.telopColorDistance);
  const frameDir = path.join(workDir, 'qc-telops');
  fs.mkdirSync(frameDir, { recursive: true });

  const minOpacity = Number(config.qc.thresholds.telopMinOpacity ?? 0.9);
  for (const segment of manifest.segments || []) {
    const boxed = (segment.telops || []).filter((telop) => telop.boxEnabled && telop.boxFill && telop.rect);
    // 半透明ボックスは 塗り色×opacity + 映像×(1-opacity) の混色になるため、
    // 塗り色との一致率では焼き込みの有無を判定できない（config-matome-01 の opacity 0.4 で
    // 実測 27% と、しきい値 30% を下回った。実フレームではバーは正しく描画されていた）。
    const translucent = boxed.filter((telop) => opacityOf(telop) < minOpacity);
    const telops = boxed.filter((telop) => opacityOf(telop) >= minOpacity);
    for (const telop of translucent) {
      results.push(result(
        'info',
        'frames_telop_fill_translucent_skip',
        `${segment.base} の ${telop.name} は半透明ボックス（opacity ${opacityOf(telop)}）のため焼き込み判定をスキップします。`,
      ));
    }
    if (telops.length === 0) {
      continue;
    }
    const at = Number(segment.atSec) + Math.min(Math.max(Number(segment.durationSec) / 2, 0.05), 0.3);
    for (const telop of telops) {
      const crop = safeCrop(telop.rect, manifest.signature);
      if (!crop) {
        results.push(result('error', 'frames_telop_rect_invalid', `${segment.base} の ${telop.name} 矩形が不正です。`));
        continue;
      }
      const imagePath = path.join(frameDir, `${safeName(`${segment.base}-${telop.name}-${Math.round(at * 1000)}`)}.png`);
      if (!extractCrop({ ffmpeg: tools.ffmpeg, videoPath, imagePath, at, crop })) {
        results.push(result('warn', 'frames_telop_crop_failed', `${segment.base} の ${telop.name} 矩形を抽出できませんでした。`));
        continue;
      }
      const ratio = fillRatio({ python, imagePath, color: telop.boxFill, distance });
      if (ratio === null) {
        results.push(result('info', 'frames_telop_fill_skip', `${segment.base} の ${telop.name} 色一致率を取得できませんでした。`));
        continue;
      }
      if (ratio < threshold) {
        results.push(result(
          'error',
          'frames_telop_fill_ratio',
          `${segment.base} の ${telop.name} が焼き込まれていない疑いがあります（一致率 ${(ratio * 100).toFixed(1)}%）。`,
          `期待色 #${String(telop.boxFill).replace(/^#/, '')} / しきい値 ${(threshold * 100).toFixed(0)}%`,
        ));
      }
    }
  }
  return results;
}

export function parseBlackDetect(log) {
  const intervals = [];
  for (const line of String(log || '').split(/\r?\n/)) {
    const match = line.match(/black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)\s+black_duration:\s*([0-9.]+)/u);
    if (match) {
      intervals.push({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) });
    }
  }
  return intervals;
}

export function parseFreezeDetect(log) {
  const intervals = [];
  let start = null;
  let duration = null;
  for (const line of String(log || '').split(/\r?\n/)) {
    const startMatch = line.match(/freeze_start:\s*([0-9.]+)/u);
    if (startMatch) {
      start = Number(startMatch[1]);
      duration = null;
      continue;
    }
    const durationMatch = line.match(/freeze_duration:\s*([0-9.]+)/u);
    if (durationMatch) {
      duration = Number(durationMatch[1]);
    }
    const endMatch = line.match(/freeze_end:\s*([0-9.]+)/u);
    if (endMatch && start !== null) {
      const end = Number(endMatch[1]);
      intervals.push({ start, end, duration: duration ?? Math.max(0, end - start) });
      start = null;
      duration = null;
    }
  }
  return intervals;
}

function checkBlackDetect({ intervals, manifest, config }) {
  const minDuration = Number(config.qc.thresholds.blackMinDuration);
  const detected = intervals.filter((entry) => entry.duration >= minDuration);
  if (detected.length === 0) {
    return [];
  }
  if (!manifest) {
    return detected.map((entry) => result(
      'error',
      'frames_black_detected',
      `黒画面を検出しました（${entry.start.toFixed(2)}s〜${entry.end.toFixed(2)}s）。`,
    ));
  }
  const clipSegments = (manifest.segments || []).filter((segment) => segment.kind === 'clip');
  const results = [];
  for (const entry of detected) {
    const hit = clipSegments.find((segment) => overlapSec(entry, segment) > 0);
    if (hit) {
      results.push(result(
        'error',
        'frames_black_in_clip',
        `${hit.base} のクリップ区間に黒画面があります。`,
        `${entry.start.toFixed(2)}s〜${entry.end.toFixed(2)}s`,
      ));
    }
  }
  return results;
}

function checkFreezeDetect({ intervals, manifest, config }) {
  const minDuration = Number(config.qc.thresholds.freezeMinDuration);
  const detected = intervals.filter((entry) => entry.duration >= minDuration);
  if (detected.length === 0) {
    return [];
  }
  if (!manifest) {
    return detected.map((entry) => result(
      'warn',
      'frames_freeze_detected',
      `フリーズを検出しました（${entry.duration.toFixed(2)} 秒）。`,
      `${entry.start.toFixed(2)}s〜${entry.end.toFixed(2)}s`,
    ));
  }
  // 区切りカード・OP・ED は静止画背景なので止まっているのが設計どおり。クリップ区間だけを見る。
  const clipSegments = (manifest.segments || []).filter((segment) => segment.kind === 'clip');
  const results = [];
  for (const entry of detected) {
    const hit = clipSegments.find((segment) => overlapSec(entry, segment) >= minDuration);
    if (hit) {
      results.push(result(
        'warn',
        'frames_freeze_in_clip',
        `${hit.base} のクリップ区間が ${entry.duration.toFixed(2)} 秒フリーズしています。`,
        `${entry.start.toFixed(2)}s〜${entry.end.toFixed(2)}s`,
      ));
    }
  }
  return results;
}

function extractCrop({ ffmpeg, videoPath, imagePath, at, crop }) {
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-ss', formatSeconds(at),
      '-i', videoPath,
      '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
      '-frames:v', '1',
      imagePath,
    ], { stdio: 'ignore' });
    return fs.existsSync(imagePath);
  } catch {
    return false;
  }
}

function fillRatio({ python, imagePath, color, distance }) {
  try {
    const script = path.join(moduleDir, '..', 'phash.py');
    const out = execFileSync(python, [
      script,
      'fill',
      '--image', imagePath,
      '--color', color,
      '--distance', String(distance),
    ], { encoding: 'utf8' });
    const json = JSON.parse(out);
    return Number.isFinite(Number(json.ratio)) ? Number(json.ratio) : null;
  } catch {
    return null;
  }
}

function safeCrop(rect, signature) {
  const width = Number(signature?.width);
  const height = Number(signature?.height);
  const x = Math.max(0, Number(rect.x));
  const y = Math.max(0, Number(rect.y));
  const w = Math.min(Number(rect.w), width - x);
  const h = Math.min(Number(rect.h), height - y);
  if (![x, y, w, h].every(Number.isFinite) || w < 2 || h < 2) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

function hasCv2(python) {
  try {
    execFileSync(python, [
      '-c',
      'import cv2, sys; sys.exit(0 if hasattr(cv2, "imread") else 2)',
    ], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// manifest v2 未満には boxOpacity が無い。その場合は不透明として扱う。
function opacityOf(telop) {
  const value = Number(telop.boxOpacity);
  return Number.isFinite(value) ? value : 1;
}

function overlapSec(interval, segment) {
  const start = Math.max(interval.start, Number(segment.atSec));
  const end = Math.min(interval.end, Number(segment.atSec) + Number(segment.durationSec));
  return Math.max(0, end - start);
}

function formatSeconds(value) {
  return Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function result(level, code, message, detail = null) {
  return { level, code, message, ...(detail ? { detail } : {}) };
}
