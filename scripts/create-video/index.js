#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, outputSize, projectRoot } from './config.js';
import { collectClips } from './select.js';
import { formatDate, stripEmoji } from './ass.js';
import { renderClip } from './clip.js';
import { renderClipCard, renderEndingCard, renderOpeningCard } from './card.js';
import { concatSegments, mixBgm, probeDuration, resolveFfmpeg } from './ffmpeg.js';
import { buildSummaryEntry, writeSummary } from './summary.js';
import { writeRenderManifest } from './qc/manifest.js';
import { runQc } from './qc/index.js';
import { runStaticChecks } from './qc/checks/static.js';
import { exitCodeForResults, formatConsoleSummary, writeQcReport } from './qc/report.js';

async function main() {
  const config = loadConfig();
  const size = outputSize(config);
  const clips = collectClips(config);
  const outPath = resolveOutputPath(config, clips);
  const titleOverride = config.titleOverride || null;
  const staticResults = config.qc.enabled
    ? runStaticChecks({ config, clips, size, titleOverride })
    : [];
  if (exitCodeForResults(staticResults) !== 0) {
    const report = writeQcReport({ videoPath: outPath, results: staticResults });
    console.log(formatConsoleSummary({ results: staticResults, reportPaths: report.paths }));
    process.exitCode = 1;
    return;
  }

  const tools = resolveFfmpeg();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'createVideo-'));
  const segments = [];
  const renderedSegments = [];
  // 各セグメントの実尺を積み上げ、クリップが動画内のどの時刻に出るかを記録する。
  const summaryEntries = [];
  let timelineSec = 0;
  const pushSegment = (segment) => {
    const durationSec = probeDuration(tools.ffprobe, segment.path);
    segments.push(segment.path);
    renderedSegments.push({ ...segment, atSec: timelineSec, durationSec });
    timelineSec += durationSec;
  };

  console.log(`🚀 ${describeSelection(config)} のクリップ ${clips.length} 件をまとめ動画にします（source=${config.source}）`);
  if (config.__meta.configPath) console.log(`🧩 config: ${path.relative(projectRoot, config.__meta.configPath)}`);

  try {
    const opening = await renderOpeningCard({
      tools,
      clips,
      config,
      workDir,
      size,
      title: titleOverride || null,
    });
    if (opening) pushSegment(opening);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      console.log(`🎬 [${i + 1}/${clips.length}] 描画中: ${clip.base}`);
      const clipSegment = await renderClip({
        tools,
        clip,
        index: i,
        total: clips.length,
        config,
        workDir,
        size,
        titleOverride,
      });
      if (!clipSegment) continue;

      const cardSegment = await renderClipCard({
        tools,
        clip,
        index: i,
        total: clips.length,
        config,
        workDir,
        size,
      });
      // クリップのブロック先頭（区切りカードがあればその開始）を出現時刻とする。
      summaryEntries.push(buildSummaryEntry(clip, timelineSec));
      if (cardSegment) pushSegment(cardSegment);
      pushSegment(clipSegment);
    }

    const ending = await renderEndingCard({ tools, clips, config, workDir, size });
    if (ending) pushSegment(ending);

    if (segments.length === 0) {
      throw new Error('結合できるセグメントがありませんでした。');
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const concatTarget = config.bgm.enabled ? path.join(workDir, 'combined-nobgm.mp4') : outPath;
    console.log(`🔗 ${segments.length} セグメントを連結中...`);
    const concatResult = concatSegments({ tools, segments, outPath: concatTarget, workDir, config });

    if (config.bgm.enabled) {
      console.log('🎧 BGM をミックス中...');
      const bgmResult = mixBgm({ tools, inputPath: concatTarget, outPath, config });
      if (!bgmResult.mixed && concatTarget !== outPath) fs.copyFileSync(concatTarget, outPath);
    }

    console.log(`✅ 完成: ${outPath}`);
    console.log(`   concat: ${concatResult.method}`);

    let manifestPath = null;
    if (config.qc.manifest !== false) {
      ({ path: manifestPath } = await writeRenderManifest({
        videoOutPath: outPath,
        config,
        clips,
        renderedSegments,
        concatMethod: concatResult.method,
        totalSec: timelineSec,
        size,
      }));
      console.log(`🧾 ${path.relative(projectRoot, manifestPath)}`);
    }

    if (summaryEntries.length > 0 && config.summary.enabled !== false) {
      // 最終チャプターの長さを測るために ED まで含めた総尺を渡す。
      const summaryResult = writeSummary({
        videoOutPath: outPath,
        entries: summaryEntries,
        totalSec: timelineSec,
        config,
      });
      for (const written of summaryResult.written) {
        console.log(`📝 ${path.relative(projectRoot, written)}`);
      }
      for (const warning of summaryResult.warnings) {
        console.warn(`⚠️  ${warning}`);
      }
    }

    if (config.qc.enabled) {
      const cli = config.__meta?.cli || {};
      const qcResult = await runQc({
        videoPath: outPath,
        config,
        manifestPath,
        staticResults,
        // --contact / --review は QC の外側（コンタクトシートと LLM 目視）。結果は info 扱い。
        contact: Boolean(cli.contact) || Boolean(cli.review),
        review: Boolean(cli.review),
      });
      console.log(formatConsoleSummary({ results: qcResult.results, reportPaths: qcResult.report.paths }));
      if (qcResult.exitCode !== 0) {
        process.exitCode = qcResult.exitCode;
      }
    }
  } finally {
    if (process.env.KEEP_WORKDIR) {
      console.log(`🔧 KEEP_WORKDIR: 中間ファイルを保持 ${workDir}`);
    } else {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

function describeSelection(config) {
  if (config.select.mode === 'videoId') return `videoId="${config.select.videoId}"`;
  if (config.select.mode === 'category') return `category="${config.select.categories.join(',')}"`;
  return `files=${config.select.files.length}`;
}

function resolveOutputPath(config, clips) {
  const configured = config.output.name;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(projectRoot, configured);
  }
  const outputDir = path.isAbsolute(config.output.dir) ? config.output.dir : path.join(projectRoot, config.output.dir);
  const first = clips[0];
  const dateStr = formatDate(first.meta?.uploadDate) || 'unknown-date';
  let name;
  if (config.select.mode === 'videoId') {
    name = `${dateStr}-${config.select.videoId}-combined.mp4`;
  } else if (config.select.mode === 'category') {
    const categories = config.select.categories.join('-').replace(/[/:]/g, '_');
    name = `${dateStr}-category-${categories}-matome.mp4`;
  } else {
    name = `${dateStr}-files-matome.mp4`;
  }
  return path.join(outputDir, stripEmoji(name));
}

main().catch((err) => {
  console.error('💥 処理中にエラーが発生しました:');
  console.error(err.message);
  process.exit(1);
});
