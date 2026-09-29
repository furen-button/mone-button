#!/usr/bin/env node
// cache/createVideo の高画質クリップで、音声の pts に穴があるもの・音声長と映像長が
// ずれているものを揃え直す。
//
// yt-dlp の区間切り出しで作った 96kHz 音声には数十 ms の pts の穴（タイムスタンプだけ
// 飛んでサンプルが無い）が混ざり、そのまま連結するとクリップごとに積み上がって累積
// 音ズレになる。映像は copy のまま音声だけ再エンコードして穴を無音で埋め、長さも
// 映像に揃える。再ダウンロードは不要（ネットワークを使わない）。
import fs from 'fs';
import path from 'path';
import {
  ALIGN_GAP_TOLERANCE_MS,
  ALIGN_HOLE_TOLERANCE_MS,
  alignAudioToVideo,
  audioPtsHoleMs,
  audioVideoGapMs,
  cacheRoot,
  describeAlign,
} from './assets.js';
import { projectRoot } from './config.js';
import { resolveFfmpeg } from './ffmpeg.js';

// クリップ以外（サムネイル、モデル、プレビュー、エディタの作業用）は対象にしない。
const SKIP_DIRS = new Set(['thumbnails', 'models', 'tools', 'preview', 'editor']);

function parseArgs(argv) {
  const options = { dryRun: false, toleranceMs: ALIGN_GAP_TOLERANCE_MS, dir: cacheRoot };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--tolerance') {
      options.toleranceMs = Number(argv[++i]);
    } else if (arg === '--dir') {
      options.dir = path.resolve(projectRoot, argv[++i]);
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }
  if (!Number.isFinite(options.toleranceMs) || options.toleranceMs < 0) {
    throw new Error('--tolerance はミリ秒の数値で指定してください。');
  }
  return options;
}

function collectClips(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      found.push(...collectClips(full));
    } else if (entry.name.endsWith('.mp4') && !entry.name.endsWith('.raw.mp4') && !entry.name.endsWith('.align.mp4')) {
      found.push(full);
    }
  }
  return found;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.dir)) {
    console.error(`対象ディレクトリがありません: ${options.dir}`);
    process.exit(1);
  }

  const tools = resolveFfmpeg();
  const files = collectClips(options.dir).sort();
  console.log(`🔎 ${path.relative(projectRoot, options.dir)} の ${files.length} 件を確認します（尺差の許容 ±${options.toleranceMs}ms / 穴は ${ALIGN_HOLE_TOLERANCE_MS}ms 超で対象）`);

  const targets = [];
  for (const file of files) {
    const gapMs = audioVideoGapMs({ ffprobe: tools.ffprobe, filePath: file });
    const holeMs = audioPtsHoleMs({ ffprobe: tools.ffprobe, filePath: file });
    if (gapMs === null) {
      console.warn(`⚠️ ストリーム尺を取得できません: ${path.relative(projectRoot, file)}`);
      continue;
    }
    if (Math.abs(gapMs) > options.toleranceMs || (holeMs !== null && holeMs > ALIGN_HOLE_TOLERANCE_MS)) {
      targets.push({ file, gapMs, holeMs });
    }
  }

  if (targets.length === 0) {
    console.log('✅ 揃え直しが必要なクリップはありません。');
    return;
  }

  const holes = targets.filter((t) => Number.isFinite(t.holeMs) && t.holeMs > ALIGN_HOLE_TOLERANCE_MS);
  const totalHole = holes.reduce((sum, t) => sum + t.holeMs, 0);
  console.log(`📋 ${targets.length} 件が対象です（pts の穴あり ${holes.length} 件・穴の合計 ${Math.round(totalHole)}ms）`);
  for (const target of targets) {
    console.log(`   ${describeAlign(target).padEnd(32)} ${path.relative(projectRoot, target.file)}`);
  }

  if (options.dryRun) {
    console.log('🚧 --dry-run のため書き換えはしません。');
    return;
  }

  let aligned = 0;
  let failed = 0;
  for (const target of targets) {
    const result = alignAudioToVideo({
      ffmpeg: tools.ffmpeg,
      ffprobe: tools.ffprobe,
      filePath: target.file,
      toleranceMs: options.toleranceMs,
    });
    if (result.aligned) {
      aligned++;
      console.log(`🎚️ 揃えました: ${path.relative(projectRoot, target.file)}`);
    } else {
      failed++;
    }
  }

  console.log(`✅ ${aligned} 件を揃えました${failed > 0 ? ` / ${failed} 件は失敗しました` : ''}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
