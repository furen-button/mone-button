#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, outputSize, projectRoot } from './config.js';
import { collectClips } from './select.js';
import { formatDate, stripEmoji } from './ass.js';
import { renderClip } from './clip.js';
import { renderClipCard, renderEndingCard, renderOpeningCard } from './card.js';
import { concatSegments, mixBgm, resolveFfmpeg } from './ffmpeg.js';

async function main() {
  const config = loadConfig();
  const size = outputSize(config);
  const tools = resolveFfmpeg();
  const clips = collectClips(config);
  const outPath = resolveOutputPath(config, clips);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'createVideo-'));
  const titleOverride = config.titleOverride || null;
  const segments = [];

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
    if (opening) segments.push(opening);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      console.log(`🎬 [${i + 1}/${clips.length}] 描画中: ${clip.base}`);
      const clipSegment = renderClip({
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
      if (cardSegment) segments.push(cardSegment);
      segments.push(clipSegment);
    }

    const ending = await renderEndingCard({ tools, clips, config, workDir, size });
    if (ending) segments.push(ending);

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
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
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
