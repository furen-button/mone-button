import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { cacheRoot, downloadHighQuality, videosDir } from './assets.js';
import { buildAss, formatDate, formatTimestamp, makeTextElement, resolveTitleText } from './ass.js';
import { buildZoomFilterComplex, planZoom, zoomCropFilters } from './effects.js';
import { formatAvoidLog, planSerifAvoidance } from './avoid.js';
import { formatEnhanceLog, planEnhance, restoreFilter, upscaleFilter } from './enhance.js';
import { AUDIO_RESAMPLE, encodeArgs, subtitlesFilter } from './ffmpeg.js';

export function clipSourcePathFor(clip, config) {
  if (config.source === 'existing') {
    return path.join(videosDir, `${clip.base}.mp4`);
  }
  return path.join(cacheRoot, clip.videoId, `${clip.base}.mp4`);
}

export function resolveClipSource(clip, config, { allowDownload = true, log = console.log, tools = null } = {}) {
  if (config.source === 'existing') {
    const sourceMp4 = clipSourcePathFor(clip, config);
    if (!fs.existsSync(sourceMp4)) {
      console.warn(`⚠️ 既存 mp4 が無いためスキップ: ${clip.base}.mp4`);
      return null;
    }
    return sourceMp4;
  }

  const sourceMp4 = clipSourcePathFor(clip, config);
  if (fs.existsSync(sourceMp4)) {
    log(`♻️ キャッシュ再利用: ${clip.base}.mp4`);
  } else if (!allowDownload) {
    return null;
  } else {
    log(`⏬ 高画質ダウンロード中: ${clip.base}`);
    downloadHighQuality(clip, sourceMp4, { normalize: config.normalizeCache !== false, tools });
  }
  return sourceMp4;
}

export async function renderClip({ tools, clip, index, total, config, workDir, size, titleOverride }) {
  const sourceMp4 = resolveClipSource(clip, config, { tools });
  if (!sourceMp4) {
    return null;
  }

  const assPath = path.join(workDir, `clip-${String(index).padStart(4, '0')}.ass`);
  const outPath = path.join(workDir, `clip-${String(index).padStart(4, '0')}.mp4`);
  const plan = await planClipRender({
    tools,
    clip,
    index,
    total,
    config,
    size,
    workDir,
    sourceMp4,
    assPath,
    titleOverride,
  });
  fs.writeFileSync(assPath, plan.ass);
  execClip(tools.ffmpeg, sourceMp4, plan.graph, outPath, config);
  return {
    path: outPath,
    kind: 'clip',
    clip,
    sourcePath: sourceMp4,
    elements: plan.elements,
    zoom: plan.zoom,
    avoid: plan.avoid,
    enhance: plan.enhance,
  };
}

export async function planClipRender({
  tools,
  clip,
  index,
  total,
  config,
  size,
  workDir,
  sourceMp4,
  assPath,
  titleOverride = null,
  plans = {},
  probe = null,
  log = console.log,
}) {
  // ズームの切り出しで顔の出力座標が変わるため、顔回避はズーム計画の後に決める。
  const zoom = await resolveRenderPlan(plans.zoom, () => planZoom({ tools, clip, sourceMp4, config, size, workDir }));
  if (zoom?.skip) {
    log(`   🔎 ズーム: なし (${zoom.skip})`);
  } else if (zoom) {
    log(formatZoomLog(zoom));
  }

  // 補正（Anime4K）は出力解像度に揃えた後のフィルタ列に入るだけで、顔検出やテロップの座標には影響しない。
  const enhance = await resolveRenderPlan(plans.enhance, () => planEnhance({ tools, clip, sourceMp4, config, probe }));
  const enhanceLog = formatEnhanceLog(enhance);
  if (enhanceLog) {
    log(enhanceLog);
  }

  const avoid = await resolveRenderPlan(plans.avoid, () => planSerifAvoidance({ tools, clip, sourceMp4, config, size, workDir, zoom }));
  const avoidLog = formatAvoidLog(avoid);
  if (avoidLog) {
    log(avoidLog);
  }
  const serifOverrides = avoid?.applied ? { marginL: avoid.marginL, marginR: avoid.marginR } : null;
  const elements = buildClipElements({ clip, index, total, config, size, titleOverride, serifOverrides });
  const ass = buildAss(elements, { width: size.width, height: size.height, font: config.font });

  const baseFilters = [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${size.fps}`,
    // 等倍の線復元は fps を揃えた後（60fps ソースでも出力 fps 分だけ処理）、ズームの切り出しやテロップより前に掛ける。
    ...(enhance?.applied && enhance.restorePreset ? [restoreFilter(enhance), 'setsar=1'] : []),
  ];
  // ズームの切り出し後の拡大。補正が効くときだけ lanczos を CNN 拡大に差し替える。
  const upscale = enhance?.applied && enhance.upscalePreset ? upscaleFilter(enhance, size) : null;
  const subFilter = subtitlesFilter(assPath, config.fontsDir);

  if (zoom && !zoom.skip && zoom.at > 0) {
    return {
      zoom,
      enhance,
      avoid,
      serifOverrides,
      elements,
      ass,
      graph: { complex: buildZoomFilterComplex({ baseFilters, subFilter, zoom, size, upscale }) },
    };
  }

  const vf = [
    ...baseFilters,
    ...(zoom && !zoom.skip ? zoomCropFilters({ zoom, size, upscale }) : []),
    subFilter,
  ].join(',');

  return {
    zoom,
    enhance,
    avoid,
    serifOverrides,
    elements,
    ass,
    graph: { vf },
  };
}

async function resolveRenderPlan(plan, run) {
  if (plan === false || plan === null) {
    return null;
  }
  if (typeof plan === 'object') {
    return plan;
  }
  return run();
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
    // yt-dlp の区間切り出しで作った 96kHz 音声のソースには、数十 ms の pts の穴
    // （タイムスタンプだけ飛んでサンプルが無い）が混ざる。async 無しで通すと穴が
    // そのまま AAC パケットの長い duration になり、プレイヤーは pts を尊重するので
    // 穴以降の音声が遅れ、連結でクリップごとに積み上がる。min_hard_comp を 1ms に
    // 下げて穴を無音で埋め、pts とサンプル数を一致させる（async=1 だけだと既定の
    // 0.1 秒未満の穴は埋まらず、穴を捨てて音声が早まる）。
    // apad + -shortest は使わない。encodeArgs の -r（CFR）と組み合わさると -shortest が
    // 効かず、無限長になった音声に映像フレームが追従してセグメントが際限なく伸びる。
    '-af', `${AUDIO_RESAMPLE},aformat=sample_fmts=fltp:channel_layouts=stereo`,
    ...encodeArgs(config),
    outPath,
  ];
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
}

function formatZoomLog(zoom) {
  const focus = zoom.focus;
  const note = focus.note ? ` (${focus.note})` : '';
  const peak = Number.isFinite(zoom.peakDb) ? ` peak=${zoom.peakDb.toFixed(1)}dB` : '';
  const range = zoom.mode === 'full' ? '全編' : `${zoom.at.toFixed(2)}s〜`;
  return [
    `   🔎 ズーム: ${range} scale=${zoom.scale}`,
    `焦点=${focus.source}(${focus.x.toFixed(2)},${focus.y.toFixed(2)})${note}`,
    `(${zoom.origin}${peak})`,
  ].join(' ');
}

export function buildClipElements({ clip, index, total, config, size, titleOverride, serifOverrides = null }) {
  const meta = clip.meta || {};
  const dateText = formatDate(meta.uploadDate);
  const duration = clip.duration || Math.max(0.1, clip.endTime - clip.startTime);
  const titleText = resolveTitleText({ clip, config, titleOverride });
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
    // 顔回避で左右非対称にする場合は marginL / marginR がここから入る。
    overrides: { layer: 6, ...(serifOverrides || {}) },
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
