import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { cacheRoot, downloadHighQuality, videosDir } from './assets.js';
import { buildAss, formatDate, formatTimestamp, makeTextElement, stripEmoji } from './ass.js';
import { buildZoomFilterComplex, planZoom, zoomCropFilters } from './effects.js';
import { encodeArgs, subtitlesFilter } from './ffmpeg.js';

export function resolveClipSource(clip, config) {
  if (config.source === 'existing') {
    const sourceMp4 = path.join(videosDir, `${clip.base}.mp4`);
    if (!fs.existsSync(sourceMp4)) {
      console.warn(`⚠️ 既存 mp4 が無いためスキップ: ${clip.base}.mp4`);
      return null;
    }
    return sourceMp4;
  }

  const sourceMp4 = path.join(cacheRoot, clip.videoId, `${clip.base}.mp4`);
  if (fs.existsSync(sourceMp4)) {
    console.log(`♻️ キャッシュ再利用: ${clip.base}.mp4`);
  } else {
    console.log(`⏬ 高画質ダウンロード中: ${clip.base}`);
    downloadHighQuality(clip, sourceMp4, { normalize: config.normalizeCache !== false });
  }
  return sourceMp4;
}

export async function renderClip({ tools, clip, index, total, config, workDir, size, titleOverride }) {
  const sourceMp4 = resolveClipSource(clip, config);
  if (!sourceMp4) {
    return null;
  }

  const assPath = path.join(workDir, `clip-${String(index).padStart(4, '0')}.ass`);
  const outPath = path.join(workDir, `clip-${String(index).padStart(4, '0')}.mp4`);
  const elements = buildClipElements({ clip, index, total, config, size, titleOverride });
  fs.writeFileSync(assPath, buildAss(elements, { width: size.width, height: size.height, font: config.font }));

  const baseFilters = [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${size.fps}`,
  ];
  const subFilter = subtitlesFilter(assPath, config.fontsDir);
  const zoom = await planZoom({ tools, clip, sourceMp4, config, size, workDir });

  if (zoom?.skip) {
    console.log(`   🔎 ズーム: なし (${zoom.skip})`);
  } else if (zoom) {
    console.log(formatZoomLog(zoom));
  }

  if (zoom && !zoom.skip && zoom.at > 0) {
    execClip(tools.ffmpeg, sourceMp4, {
      complex: buildZoomFilterComplex({ baseFilters, subFilter, zoom, size }),
    }, outPath, config);
    return outPath;
  }

  const vf = [
    ...baseFilters,
    ...(zoom && !zoom.skip ? zoomCropFilters({ zoom, size }) : []),
    subFilter,
  ].join(',');

  execClip(tools.ffmpeg, sourceMp4, { vf }, outPath, config);
  return outPath;
}

function execClip(ffmpeg, sourceMp4, graph, outPath, config) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.rmSync(outPath, { force: true });
  const filterArgs = graph.complex
    ? ['-filter_complex', graph.complex, '-map', '[v]', '-map', '0:a?']
    : ['-vf', graph.vf];
  const args = [
    '-y',
    '-i', sourceMp4,
    ...filterArgs,
    '-af', 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo',
    ...encodeArgs(config),
    outPath,
  ];
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
}

function formatZoomLog(zoom) {
  const focus = zoom.focus;
  const note = focus.note ? ` (${focus.note})` : '';
  const peak = Number.isFinite(zoom.peakDb) ? ` peak=${zoom.peakDb.toFixed(1)}dB` : '';
  return [
    `   🔎 ズーム: ${zoom.at.toFixed(2)}s〜 scale=${zoom.scale}`,
    `焦点=${focus.source}(${focus.x.toFixed(2)},${focus.y.toFixed(2)})${note}`,
    `(${zoom.origin}${peak})`,
  ].join(' ');
}

export function buildClipElements({ clip, index, total, config, size, titleOverride }) {
  const meta = clip.meta || {};
  const dateText = formatDate(meta.uploadDate);
  const duration = clip.duration || Math.max(0.1, clip.endTime - clip.startTime);
  const titleText = titleOverride || stripEmoji(meta.title || '');
  const elements = [];

  elements.push(makeTextElement({
    name: 'title',
    text: titleText,
    style: config.telops.title,
    width: size.width,
    height: size.height,
    duration,
  }));
  elements.push(makeTextElement({
    name: 'date',
    text: dateText,
    style: config.telops.date,
    width: size.width,
    height: size.height,
    duration,
    overrides: { outline: 2, outlineColor: '000000', shadow: 1, shadowColor: '000000' },
  }));
  elements.push(makeTextElement({
    name: 'time',
    text: clip.startTime !== undefined ? formatTimestamp(clip.startTime) : '',
    style: config.telops.time,
    width: size.width,
    height: size.height,
    duration,
    overrides: { outline: 2, outlineColor: '000000', shadow: 1, shadowColor: '000000' },
  }));
  elements.push(makeTextElement({
    name: 'serif',
    text: clip.data.serif || '',
    style: config.telops.serif,
    width: size.width,
    height: size.height,
    duration,
    overrides: { layer: 6 },
  }));

  const progressText = (config.telops.progress.format || '{i} / {n}')
    .replaceAll('{i}', String(index + 1))
    .replaceAll('{n}', String(total));
  elements.push(makeTextElement({
    name: 'progress',
    text: progressText,
    style: config.telops.progress,
    width: size.width,
    height: size.height,
    duration,
    index: index + 1,
    total,
    overrides: { outline: 2, outlineColor: '000000', shadow: 1, shadowColor: '000000' },
  }));

  return elements.filter(Boolean);
}
