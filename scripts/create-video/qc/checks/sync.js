import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(__filename);

export function runSyncChecks({ tools, videoPath, manifest, config, workDir }) {
  if (!manifest) {
    return [
      result('info', 'sync_audio_skip', 'manifest が無いため A/V 同期検査をスキップします。'),
      result('info', 'sync_phash_skip', 'manifest が無いためクリップ同一性検査をスキップします。'),
    ];
  }
  const python = String(config.qc.python || 'python3');
  const results = [];
  const segments = (manifest.segments || []).filter((segment) => segment.kind === 'clip');
  results.push(...runAudioSyncChecks({ tools, videoPath, segments, config, workDir, python }));
  results.push(...runPhashChecks({ tools, videoPath, segments, manifest, config, workDir, python }));
  return results;
}

function runAudioSyncChecks({ tools, videoPath, segments, config, workDir, python }) {
  if (!hasPythonModule(python, 'numpy')) {
    return [result('info', 'sync_audio_numpy_skip', 'numpy が無いため A/V 同期検査をスキップします。')];
  }
  const results = [];
  const dir = path.join(workDir, 'qc-sync');
  fs.mkdirSync(dir, { recursive: true });
  const driftThreshold = Number(config.qc.thresholds.driftMs) / 1000;
  const minCorrelation = Number(config.qc.thresholds.minSyncCorrelation);

  for (const segment of segments) {
    if (!segment.sourcePath || !fs.existsSync(resolvePath(segment.sourcePath))) {
      results.push(result('info', 'sync_audio_source_skip', `${segment.base} のソース音声が無いため A/V 同期検査をスキップします。`));
      continue;
    }
    const sourceWav = path.join(dir, `${safeName(segment.base)}-source.wav`);
    const targetWav = path.join(dir, `${safeName(segment.base)}-target.wav`);
    const sourceOk = extractAudio({ ffmpeg: tools.ffmpeg, inputPath: resolvePath(segment.sourcePath), outPath: sourceWav, start: 0, duration: 2 });
    const windowStart = Math.max(0, Number(segment.atSec) - 1);
    const targetOk = extractAudio({ ffmpeg: tools.ffmpeg, inputPath: videoPath, outPath: targetWav, start: windowStart, duration: 4 });
    if (!sourceOk || !targetOk) {
      results.push(result('info', 'sync_audio_extract_skip', `${segment.base} の音声抽出に失敗したため A/V 同期検査をスキップします。`));
      continue;
    }

    const measured = measureAudioOffset({ python, sourceWav, targetWav });
    if (!measured) {
      results.push(result('info', 'sync_audio_measure_skip', `${segment.base} の相互相関を計算できませんでした。`));
      continue;
    }
    if (measured.correlation < minCorrelation) {
      results.push(result(
        'warn',
        'sync_audio_low_correlation',
        `${segment.base} は音声特徴が弱く同期位置を確定できません。`,
        `correlation=${measured.correlation.toFixed(3)} / 下限 ${minCorrelation}`,
      ));
      continue;
    }
    const actualAt = windowStart + measured.targetOffsetSec;
    const drift = actualAt - Number(segment.atSec);
    if (Math.abs(drift) > driftThreshold) {
      results.push(result(
        'error',
        'sync_audio_drift',
        `${segment.base} の音声位置が ${Math.round(drift * 1000)}ms ずれています。`,
        `実測 ${actualAt.toFixed(3)}s / 期待 ${Number(segment.atSec).toFixed(3)}s`,
      ));
    }
  }
  return results;
}

function runPhashChecks({ tools, videoPath, segments, manifest, config, workDir, python }) {
  if (!hasPythonModule(python, 'cv2')) {
    return [result('info', 'sync_phash_cv2_skip', 'cv2 が無いためクリップ同一性検査をスキップします。')];
  }
  const results = [];
  const dir = path.join(workDir, 'qc-phash');
  fs.mkdirSync(dir, { recursive: true });
  const threshold = Number(config.qc.thresholds.phashDistance);
  const size = manifest.signature || {};
  const compareCrop = centerCompareCrop(size);

  for (const segment of segments) {
    if (segment.zoom) {
      results.push(result('info', 'sync_phash_zoom_skip', `${segment.base} はズーム済みのため pHash 同一性検査をスキップします。`));
      continue;
    }
    if (!segment.sourcePath || !fs.existsSync(resolvePath(segment.sourcePath))) {
      results.push(result('info', 'sync_phash_source_skip', `${segment.base} のソース映像が無いためクリップ同一性検査をスキップします。`));
      continue;
    }
    const at = Number(segment.atSec) + Math.min(0.2, Math.max(0.05, Number(segment.durationSec) / 2));
    const sourceFrame = path.join(dir, `${safeName(segment.base)}-source.png`);
    const targetFrame = path.join(dir, `${safeName(segment.base)}-target.png`);
    const sourceOk = extractFrame({
      ffmpeg: tools.ffmpeg,
      inputPath: resolvePath(segment.sourcePath),
      outPath: sourceFrame,
      at: Math.min(0.2, Math.max(0.05, Number(segment.durationSec) / 2)),
      vf: [
        `scale=${Number(size.width)}:${Number(size.height)}:force_original_aspect_ratio=decrease`,
        `pad=${Number(size.width)}:${Number(size.height)}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
        compareCrop,
      ].join(','),
    });
    const targetOk = extractFrame({ ffmpeg: tools.ffmpeg, inputPath: videoPath, outPath: targetFrame, at, vf: compareCrop });
    if (!sourceOk || !targetOk) {
      results.push(result('info', 'sync_phash_extract_skip', `${segment.base} のフレーム抽出に失敗しました。`));
      continue;
    }
    const distance = phashDistance({ python, left: sourceFrame, right: targetFrame });
    if (distance === null) {
      results.push(result('info', 'sync_phash_measure_skip', `${segment.base} の pHash を計算できませんでした。`));
      continue;
    }
    if (distance > threshold) {
      results.push(result(
        'error',
        'sync_phash_mismatch',
        `${segment.base} の先頭フレームがソースと一致しません。`,
        `pHash distance=${distance} / 上限 ${threshold}`,
      ));
    }
  }
  return results;
}

function centerCompareCrop(size) {
  const width = Number(size.width) || 1280;
  const height = Number(size.height) || 720;
  const cropWidth = even(Math.round(width * 0.55));
  const cropHeight = even(Math.round(height * 0.45));
  const x = even(Math.round((width - cropWidth) / 2));
  const y = even(Math.round(height * 0.22));
  return `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
}

function extractAudio({ ffmpeg, inputPath, outPath, start, duration }) {
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-hide_banner',
      '-v', 'error',
      '-ss', formatSeconds(start),
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-t', String(duration),
      outPath,
    ], { stdio: 'ignore' });
    return fs.existsSync(outPath);
  } catch {
    return false;
  }
}

function extractFrame({ ffmpeg, inputPath, outPath, at, vf = null }) {
  const args = [
    '-y',
    '-hide_banner',
    '-v', 'error',
    '-ss', formatSeconds(at),
    '-i', inputPath,
  ];
  if (vf) {
    args.push('-vf', vf);
  }
  args.push('-frames:v', '1', outPath);
  try {
    execFileSync(ffmpeg, args, { stdio: 'ignore' });
    return fs.existsSync(outPath);
  } catch {
    return false;
  }
}

function measureAudioOffset({ python, sourceWav, targetWav }) {
  try {
    const out = execFileSync(python, [
      path.join(moduleDir, '..', 'sync_xcorr.py'),
      '--source', sourceWav,
      '--target', targetWav,
    ], { encoding: 'utf8' });
    const json = JSON.parse(out);
    if (!Number.isFinite(Number(json.targetOffsetSec))) {
      return null;
    }
    return {
      targetOffsetSec: Number(json.targetOffsetSec),
      correlation: Number(json.correlation) || 0,
    };
  } catch {
    return null;
  }
}

function phashDistance({ python, left, right }) {
  try {
    const out = execFileSync(python, [
      path.join(moduleDir, '..', 'phash.py'),
      'compare',
      '--left', left,
      '--right', right,
    ], { encoding: 'utf8' });
    const json = JSON.parse(out);
    return Number.isFinite(Number(json.distance)) ? Number(json.distance) : null;
  } catch {
    return null;
  }
}

function hasPythonModule(python, moduleName) {
  try {
    execFileSync(python, ['-c', `import ${moduleName}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function formatSeconds(value) {
  return Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function result(level, code, message, detail = null) {
  return { level, code, message, ...(detail ? { detail } : {}) };
}
