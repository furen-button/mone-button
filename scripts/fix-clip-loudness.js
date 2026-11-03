#!/usr/bin/env node
// public/videos のクリップ mp4 の音量を -23 LUFS（取り込みの ffmpeg-normalize と同じ基準）へ揃え直す。
// 波形トリム・切り出しが音量を揃えていなかった頃に作った mp4 向け（30 秒窓で揃えたゲインのまま一部を切ったので、
// 短いクリップほど大きく外れている）。映像は copy のまま音声だけ作り直し、元の mp4 は trash/loudness/ へ複製して
// 聞き比べ・差し戻しができるようにする。高画質キャッシュ（cache/createVideo）は触らない。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AUDIO_RESAMPLE, resolveFfmpeg } from './create-video/ffmpeg.js';
import { LOUDNESS_TARGET_LUFS, loudnessGain, measureLoudness, volumeFilter } from './dev-server/lib/loudness.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const videosDir = path.join(repoRoot, 'public/videos');
const backupDir = path.join(repoRoot, 'trash/loudness');
const tmpDir = path.join(repoRoot, 'cache/clip-loudness');

// QC の音量の許容（-23 LUFS ±2）と揃える。
export const DEFAULT_TOLERANCE_LU = 2;
const CONCURRENCY = 8;

export function parseArgs(argv) {
  const options = { dryRun: false, toleranceLu: DEFAULT_TOLERANCE_LU, only: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--tolerance') {
      options.toleranceLu = Number(argv[++i]);
    } else if (arg === '--only') {
      const names = String(argv[++i] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) {
        throw new Error('--only にはクリップ名（拡張子なし）をカンマ区切りで指定してください。');
      }
      options.only = [...(options.only ?? []), ...names];
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }
  if (!Number.isFinite(options.toleranceLu) || options.toleranceLu < 0) {
    throw new Error('--tolerance は LU の数値（0 以上）で指定してください。');
  }
  const invalid = (options.only ?? []).find((name) => !/^[\w-]+$/.test(name));
  if (invalid) {
    throw new Error(`クリップ名が不正です: ${invalid}`);
  }
  return options;
}

// 測った結果から、直すもの（targets）と、外れているが直さないもの（skipped）を分ける。
export function planFixes(measurements, toleranceLu) {
  const targets = [];
  const skipped = [];
  for (const item of measurements) {
    if (!Number.isFinite(item.integrated) || Math.abs(item.integrated - LOUDNESS_TARGET_LUFS) <= toleranceLu) {
      continue;
    }
    const gain = loudnessGain(item);
    if (volumeFilter(gain.gainDb) === null) {
      skipped.push({ ...item, ...gain });
    } else {
      targets.push({ ...item, ...gain });
    }
  }
  const byOffset = (a, b) => Math.abs(b.integrated - LOUDNESS_TARGET_LUFS) - Math.abs(a.integrated - LOUDNESS_TARGET_LUFS);
  return { targets: targets.sort(byOffset), skipped: skipped.sort(byOffset) };
}

function describe(item) {
  const level = `${item.integrated.toFixed(1)} LUFS (TP ${Number.isFinite(item.truePeak) ? item.truePeak.toFixed(1) : '-inf'})`;
  const gain = `${item.gainDb >= 0 ? '+' : ''}${item.gainDb.toFixed(2)} dB`;
  const note = item.reason === 'peak' ? ' true peak で頭打ち' : item.reason === 'unmeasurable' ? ' 測れない' : '';
  return `${level.padEnd(24)} ${gain.padStart(10)}${note}`;
}

async function mapPool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function backupPath(base) {
  const first = path.join(backupDir, `${base}.mp4`);
  return fs.existsSync(first) ? path.join(backupDir, `${base}.${Date.now()}.mp4`) : first;
}

async function fixFile({ ffmpeg, item }) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${item.base}-${process.pid}.mp4`);
  try {
    // 波形トリムの encodeRange と同じ音声設定（AUDIO_RESAMPLE → AAC 96k / 44.1kHz / stereo）。
    await execFileAsync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', item.file,
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
      '-af', `${AUDIO_RESAMPLE},${volumeFilter(item.gainDb)}`,
      '-movflags', '+faststart',
      tmpPath,
    ]);
    const backup = backupPath(item.base);
    fs.copyFileSync(item.file, backup);
    fs.renameSync(tmpPath, item.file);
    return backup;
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { ffmpeg } = resolveFfmpeg();

  let bases = fs.readdirSync(videosDir).filter((name) => name.endsWith('.mp4')).map((name) => name.slice(0, -4)).sort();
  if (options.only) {
    const missing = options.only.filter((name) => !bases.includes(name));
    if (missing.length > 0) {
      throw new Error(`public/videos にありません: ${missing.join(', ')}`);
    }
    bases = options.only;
  }

  console.log(`🔎 public/videos の ${bases.length} 件を測ります（目標 ${LOUDNESS_TARGET_LUFS} LUFS ±${options.toleranceLu} LU）`);
  const measurements = await mapPool(bases, async (base) => {
    const file = path.join(videosDir, `${base}.mp4`);
    return { base, file, ...(await measureLoudness({ ffmpeg, input: file })) };
  });

  if (options.only) {
    for (const item of measurements) {
      const inRange = Number.isFinite(item.integrated) && Math.abs(item.integrated - LOUDNESS_TARGET_LUFS) <= options.toleranceLu;
      if (inRange) {
        console.log(`   範囲内のため対象外: ${item.integrated.toFixed(1)} LUFS ${item.base}`);
      }
    }
  }

  const { targets, skipped } = planFixes(measurements, options.toleranceLu);
  for (const item of skipped) {
    console.log(`   直さない: ${describe(item)} ${item.base}`);
  }
  if (targets.length === 0) {
    console.log('✅ 揃え直しが必要なクリップはありません。');
    return;
  }

  console.log(`📋 ${targets.length} 件が対象です`);
  for (const item of targets) {
    console.log(`   ${describe(item)} ${item.base}`);
  }
  if (options.dryRun) {
    console.log('🚧 --dry-run のため書き換えはしません。');
    return;
  }

  let failed = 0;
  await mapPool(targets, async (item) => {
    try {
      const backup = await fixFile({ ffmpeg, item });
      const after = await measureLoudness({ ffmpeg, input: item.file });
      const afterText = Number.isFinite(after.integrated) ? after.integrated.toFixed(1) : '?';
      console.log(`🎚️ ${item.integrated.toFixed(1)} → ${afterText} LUFS ${item.base}（元: ${path.relative(repoRoot, backup)}）`);
    } catch (error) {
      failed++;
      console.error(`❌ ${item.base}: ${String(error.message).split('\n')[0]}`);
    }
  });

  console.log(`✅ ${targets.length - failed} 件を揃えました${failed > 0 ? ` / ${failed} 件は失敗しました` : ''}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

// スクリプトとして実行されたときだけ動かす（テストからの import では動かさない）
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`❌ エラー: ${error.message}`);
    process.exitCode = 1;
  });
}
