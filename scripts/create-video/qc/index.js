#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULTS, deepMerge, loadConfig, outputSize, parseArgs, projectRoot } from '../config.js';
import { resolveFfmpeg } from '../ffmpeg.js';
import { collectClips } from '../select.js';
import { runStaticChecks } from './checks/static.js';
import { readManifestFor, relativePath } from './manifest.js';
import { exitCodeForResults, formatConsoleSummary, summarizeResults, writeQcReport } from './report.js';
import { runFrameLogChecks, runTelopFillChecks } from './checks/frames.js';
import { runLoudnessChecks, runMediaScan } from './checks/loudness.js';
import { buildContactSheet, contactSheetPathFor } from './contact.js';
import { reviewPathFor, runVisualReview } from './review.js';
import { runProbeChecks } from './checks/probe.js';
import { runSyncChecks } from './checks/sync.js';

const __filename = fileURLToPath(import.meta.url);

export async function runQc({
  videoPath,
  config = loadQcConfig([]),
  manifestPath = null,
  staticResults = [],
  allowStaleManifest = false,
  contact = false,
  review = false,
}) {
  const tools = resolveFfmpeg();
  const resolvedVideo = path.isAbsolute(videoPath) ? videoPath : path.join(projectRoot, videoPath);
  if (!fs.existsSync(resolvedVideo)) {
    throw new Error(`動画ファイルが見つかりません: ${resolvedVideo}`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'createVideo-qc-'));
  try {
    const manifestResult = await readManifestFor(resolvedVideo, manifestPath, { allowStaleManifest });
    const loadedManifest = manifestResult.manifest;
    const manifestUsable = !(manifestResult.results || []).some((item) => item.level === 'error' && item.code === 'manifest_stale');
    const manifest = manifestUsable ? loadedManifest : null;
    const results = [...staticResults];
    if (allowStaleManifest) {
      results.push({
        level: 'info',
        code: 'manifest_stale_allow_enabled',
        message: '--allow-stale-manifest（検証用）が指定されたため、manifest の陳腐化は error にしません。',
      });
    }
    results.push(...(manifestResult.results || []));
    if (!loadedManifest) {
      results.push({ level: 'info', code: 'manifest_missing', message: 'render.json が無いため manifest 依存の検査は skip します。' });
    }

    const probe = runProbeChecks({ tools, videoPath: resolvedVideo, manifest, config });
    results.push(...probe.results);

    const scan = runMediaScan({ tools, videoPath: resolvedVideo, config });
    results.push(...scan.results);
    if (scan.log) {
      results.push(...runLoudnessChecks({ scanLog: scan.log, manifest, config }));
      results.push(...runFrameLogChecks({ scanLog: scan.log, manifest, config }));
    }

    results.push(...runSyncChecks({ tools, videoPath: resolvedVideo, manifest, config, workDir }));
    results.push(...runTelopFillChecks({ tools, videoPath: resolvedVideo, manifest, config, workDir }));

    // コンタクトシートと LLM 目視レビューは決定論的検査の外側なので、
    // 結果は常に info（合否には影響させない）。
    if (contact || review) {
      const sheet = buildContactSheet({
        tools,
        videoPath: resolvedVideo,
        manifest,
        config,
        outPath: contactSheetPathFor(resolvedVideo),
        workDir,
      });
      if (sheet.skipped) {
        results.push({ level: 'info', code: 'contact_sheet_skip', message: sheet.skipped });
      } else {
        results.push({
          level: 'info',
          code: 'contact_sheet',
          message: `コンタクトシートを書き出しました（${sheet.cells.length} マス / ${sheet.columns}x${sheet.rows}）。`,
          detail: relativePath(sheet.outPath),
        });
        if (review) {
          const reviewed = runVisualReview({
            sheetPath: sheet.outPath,
            cells: sheet.cells,
            outPath: reviewPathFor(resolvedVideo),
            config,
          });
          results.push(reviewed.skipped
            ? { level: 'info', code: 'visual_review_skip', message: reviewed.skipped }
            : {
              level: 'info',
              code: 'visual_review',
              message: 'LLM 目視レビューを書き出しました（合否には影響しません）。',
              detail: relativePath(reviewed.outPath),
            });
        }
      }
    }

    const report = writeQcReport({
      videoPath: resolvedVideo,
      manifestPath: loadedManifest ? manifestResult.path : null,
      results,
    });
    return {
      results,
      report,
      exitCode: exitCodeForResults(results),
    };
  } finally {
    if (process.env.KEEP_WORKDIR) {
      console.log(`🔧 KEEP_WORKDIR: QC 中間ファイルを保持 ${workDir}`);
    } else {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

// 生成前に L0 だけを回す。ffmpeg も mp4 も要らないので、長いエンコードの前に
// ラインナップ全体を検査する用途に使う。
export function runPreflight(argv = process.argv.slice(2)) {
  const config = loadConfig(argv);
  const size = outputSize(config);
  const clips = collectClips(config);
  const results = runStaticChecks({
    config,
    clips,
    size,
    titleOverride: config.titleOverride || null,
  });
  return { clips, results, exitCode: exitCodeForResults(results) };
}

// output/*.mp4 をまとめてレビューする。1 本でも error があれば全体を非ゼロ終了にする。
export async function runAllQc(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const dirOption = optString(opts, 'dir');
  const dir = dirOption ? path.resolve(projectRoot, dirOption) : path.join(projectRoot, 'output');
  if (!fs.existsSync(dir)) {
    throw new Error(`ディレクトリが見つかりません: ${dir}`);
  }
  const videos = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.mp4'))
    .sort()
    .map((name) => path.join(dir, name));
  if (videos.length === 0) {
    throw new Error(`mp4 が見つかりません: ${dir}`);
  }

  const config = loadQcConfig(argv);
  const allowStaleManifest = Boolean(opts['allow-stale-manifest']);
  const rows = [];
  for (const videoPath of videos) {
    const label = path.basename(videoPath);
    try {
      const { results } = await runQc({ videoPath, config, allowStaleManifest });
      rows.push({ label, ...summarizeResults(results) });
    } catch (err) {
      rows.push({ label, error: 1, warn: 0, info: 0, failed: err.message });
    }
  }
  return { rows, exitCode: rows.some((row) => row.error > 0) ? 1 : 0 };
}

export function loadQcConfig(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const configPath = optString(opts, 'config')
    ? path.resolve(projectRoot, optString(opts, 'config'))
    : path.join(projectRoot, 'scripts/create-video/config.json');
  let config = structuredClone(DEFAULTS);
  if (fs.existsSync(configPath)) {
    config = deepMerge(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  }
  config.__meta = {
    configPath: fs.existsSync(configPath) ? configPath : null,
    cli: opts,
  };
  return config;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.help || opts.h) {
    console.log(helpText());
    return Promise.resolve();
  }
  if (opts.preflight) {
    const { clips, results } = runPreflight(argv);
    console.log(`🧾 preflight: クリップ ${clips.length} 件を生成前に検査しました`);
    console.log(formatConsoleSummary({ results, reportPaths: null }));
    process.exitCode = exitCodeForResults(results);
    return Promise.resolve();
  }

  if (opts.all) {
    return runAllQc(argv).then(({ rows, exitCode }) => {
      console.log(formatBatchTable(rows));
      process.exitCode = exitCode;
    });
  }

  const video = optString(opts, 'video');
  if (!video) {
    throw new Error(`QC 対象の動画を --video で指定してください。\n\n${helpText()}`);
  }
  const manifest = optString(opts, 'manifest');
  return runQc({
    videoPath: video,
    config: loadQcConfig(argv),
    manifestPath: manifest ? path.resolve(projectRoot, manifest) : null,
    allowStaleManifest: Boolean(opts['allow-stale-manifest']),
    contact: Boolean(opts.contact) || Boolean(opts.review),
    review: Boolean(opts.review),
  }).then(({ results, report, exitCode }) => {
    console.log(formatConsoleSummary({ results, reportPaths: report.paths }));
    process.exitCode = exitCode;
  });
}

export function formatBatchTable(rows) {
  const width = Math.max(...rows.map((row) => row.label.length), 4);
  const lines = [
    `${'動画'.padEnd(width)}  error  warn  info`,
    `${'-'.repeat(width)}  -----  ----  ----`,
  ];
  for (const row of rows) {
    if (row.failed) {
      lines.push(`${row.label.padEnd(width)}  検査できませんでした: ${row.failed}`);
      continue;
    }
    lines.push(`${row.label.padEnd(width)}  ${String(row.error).padStart(5)}  ${String(row.warn).padStart(4)}  ${String(row.info).padStart(4)}`);
  }
  const totalError = rows.reduce((sum, row) => sum + row.error, 0);
  lines.push('');
  lines.push(`🧪 ${rows.length} 本を検査しました（error 合計 ${totalError}）`);
  return lines.join('\n');
}

function helpText() {
  return [
    '使い方:',
    '  npm run qc -- --video output/xxx.mp4 [--manifest output/xxx.render.json]',
    '  npm run qc -- --preflight --videoId <id>    生成せず L0 だけを回す',
    '  npm run qc -- --all [--dir output]          ディレクトリ内の mp4 を一括レビュー',
    '',
    'オプション:',
    '  --video <path>              QC 対象の mp4',
    '  --preflight                 生成前の静的検査のみ。createVideo と同じ選択オプションを受け付ける',
    '  --all                       --dir（既定 output）内の *.mp4 をまとめて検査',
    '  --dir <path>                --all の対象ディレクトリ',
    '  --manifest <path>           render manifest を明示指定',
    '  --config <path>             QC しきい値を含む config JSON',
    '  --contact                   代表フレームを並べたコンタクトシート PNG を書き出す',
    '  --review                    コンタクトシートを claude CLI に読ませて指摘を書き出す（非ゲート）',
    '  --allow-stale-manifest      検証用: manifest と mp4 の不一致を error にせず続行',
    '  --help                     このヘルプを表示',
  ].join('\n');
}

function optString(opts, key) {
  const value = opts[key];
  if (value === undefined || value === true || value === false) {
    return undefined;
  }
  return String(Array.isArray(value) ? value.at(-1) : value);
}

if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error('💥 QC 中にエラーが発生しました:');
    console.error(err.message);
    process.exit(1);
  });
}
