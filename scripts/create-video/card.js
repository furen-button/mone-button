import fs from 'fs';
import path from 'path';
import {
  buildAss,
  charWidth,
  formatDate,
  makeTextElement,
  resolveTitleText,
  stripEmoji,
  stripEmphasis,
} from './ass.js';
import { clipSourcePathFor } from './clip.js';
import { deepMerge, resolveProjectPath } from './config.js';
import { cacheThumbnail, optionalAsset } from './assets.js';
import { AUDIO_RESAMPLE, encodeArgs, streamSignature, subtitlesFilter } from './ffmpeg.js';
import { execFileSync } from 'child_process';

// OP/ED に完成動画が指定されていれば、その動画を 1 セグメントとして
// （映像は解像度/fps に正規化、音声はそのまま）出力する。未指定/欠落なら null。
function renderEndcapVideo({ tools, kind, config, workDir, size }) {
  const videoPath = endcapVideoPath(kind, config);
  if (!videoPath) {
    return null;
  }
  const outPath = path.join(workDir, `${kind}.mp4`);
  const vf = endcapVideoFilter(size);
  const hasAudio = streamSignature(tools.ffprobe, videoPath).some((s) => s.type === 'audio');
  const args = ['-y', '-i', videoPath];
  if (hasAudio) {
    // クリップと同じく pts の穴を無音で埋めてから揃える（clip.js の execClip を参照）。
    args.push('-vf', vf, '-af', `${AUDIO_RESAMPLE},aformat=sample_fmts=fltp:channel_layouts=stereo`);
  } else {
    // 音声トラックが無い動画には無音を付与して concat の署名を揃える。
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-vf', vf, '-map', '0:v', '-map', '1:a', '-shortest');
  }
  args.push(...encodeArgs(config), '-movflags', '+faststart', outPath);
  console.log(`🎬 ${kind} に指定動画を使用: ${path.basename(videoPath)}`);
  execFileSync(tools.ffmpeg, args, { stdio: 'inherit' });
  return { path: outPath, kind, sourcePath: videoPath, elements: [] };
}

// OP/ED に指定された完成動画のパス。未指定・欠落なら null。
export function endcapVideoPath(kind, config) {
  const spec = config.endcaps[kind] || {};
  if (!spec.video) {
    return null;
  }
  return optionalAsset(spec.video, `${kind} 動画`);
}

// 指定動画を出力解像度・fps に合わせる映像フィルタ。静止画プレビューも同じものを通す。
export function endcapVideoFilter(size) {
  return [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${size.fps}`,
  ].join(',');
}

export async function renderClipCard({ tools, clip, index, total, config, workDir, size }) {
  if (!config.cards.enabled) return null;
  const thumbnail = await cacheThumbnail(clip.videoId, config);
  return renderCard({
    tools,
    kind: 'clip',
    clip,
    index,
    total,
    config,
    workDir,
    size,
    thumbnail,
    duration: Number(config.cards.duration) || 1.5,
  });
}

export async function renderOpeningCard({ tools, clips, config, workDir, size, title }) {
  if (!config.endcaps.opening?.enabled) return null;
  const videoSegment = renderEndcapVideo({ tools, kind: 'opening', config, workDir, size });
  if (videoSegment) return videoSegment;
  return renderCard({
    tools,
    kind: 'opening',
    clips,
    index: 0,
    total: clips.length,
    config,
    workDir,
    size,
    title,
    duration: Number(config.endcaps.opening.duration) || 3,
  });
}

export async function renderEndingCard({ tools, clips, config, workDir, size }) {
  if (!config.endcaps.ending?.enabled) return null;
  const videoSegment = renderEndcapVideo({ tools, kind: 'ending', config, workDir, size });
  if (videoSegment) return videoSegment;
  return renderCard({
    tools,
    kind: 'ending',
    clips,
    index: clips.length - 1,
    total: clips.length,
    config,
    workDir,
    size,
    duration: Number(config.endcaps.ending.duration) || 4,
  });
}

async function renderCard({ tools, kind, clip, clips, index, total, config, workDir, size, thumbnail, title, duration }) {
  const plan = planCardRender({ kind, clip, clips, index, total, config, size, title, duration, thumbnail });
  const assPath = path.join(workDir, `${plan.safeKind}.ass`);
  const outPath = path.join(workDir, `${plan.safeKind}.mp4`);
  fs.writeFileSync(assPath, plan.ass);

  const command = buildCardCommand({ tools, kind, clips, assPath, outPath, config, size, duration, thumbnail });
  execFileSync(tools.ffmpeg, command, { stdio: 'inherit' });
  return {
    path: outPath,
    kind: kind === 'clip' ? 'card' : kind,
    clip,
    sourcePath: plan.background.path || cardSourcePath(config),
    elements: plan.elements,
  };
}

// カード 1 枚の「何を描くか」をまとめる。本番（renderCard）と静止画プレビュー（preview.js）が
// 同じ計画を共有するための seam。ASS のパスは呼び出し側が決めるので、ここでは本文だけ返す。
export function planCardRender({ kind, clip, clips, index, total, config, size, title, duration, thumbnail = null }) {
  const safeKind = kind === 'clip' ? `card-${String(index).padStart(4, '0')}` : kind;
  const elements = buildCardElements({ kind, clip, clips, index, total, config, size, title, duration });
  return {
    kind,
    safeKind,
    duration,
    thumbnail,
    elements,
    ass: buildAss(elements, { width: size.width, height: size.height, font: config.font }),
    sourcePath: cardSourcePath(config),
    background: cardBackground({ kind, clips, config, size, duration }),
  };
}

// ED をエンドスクリーン（YouTube の終了画面の要素を置く枠）として描くか。
export function isEndscreen(config) {
  return config.endcaps.ending?.layout === 'endscreen';
}

export function buildCardElements({ kind, clip, clips, index, total, config, size, title, duration }) {
  if (kind === 'opening') {
    const first = clips[0];
    const mainTitle = title || config.endcaps.opening.title || makeMatomeTitle(config, first);
    const subtitle = (config.endcaps.opening.subtitle || '全{n}クリップ').replaceAll('{n}', String(total));
    return [
      makeTextElement({
        name: 'opening-title',
        text: mainTitle,
        style: { enabled: true, align: 'center', size: 0.085, color: 'FFFFFF', font: config.endcaps.opening.font },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 4, outlineColor: '000000', shadow: 2, shadowColor: '000000', marginH: Math.round(size.width * 0.1) },
      }),
      makeTextElement({
        name: 'opening-subtitle',
        text: subtitle,
        style: { enabled: true, align: 'bottom-center', size: 0.05, color: 'FFFFFF', font: config.endcaps.opening.font },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 3, outlineColor: '000000', shadow: 2, shadowColor: '000000' },
      }),
    ].filter(Boolean);
  }

  if (kind === 'ending' && isEndscreen(config)) {
    return buildEndscreenElements({ config, size, duration });
  }

  if (kind === 'ending') {
    const text = config.endcaps.ending.text || 'ご視聴ありがとうございました';
    const elements = [
      makeTextElement({
        name: 'ending-text',
        text,
        style: { enabled: true, align: 'center', size: 0.075, color: 'FFFFFF', font: config.endcaps.ending.font },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 4, outlineColor: '000000', shadow: 2, shadowColor: '000000', marginH: Math.round(size.width * 0.1) },
      }),
    ];
    if (config.endcaps.ending.listClips) {
      elements.push(makeTextElement({
        name: 'ending-list',
        text: clips.slice(0, 8).map((item, i) => `${i + 1}. ${stripEmphasis(item.data.serif || '') || item.base}`).join('\n'),
        style: { enabled: true, align: 'bottom-center', size: 0.03, color: 'FFFFFF', font: config.endcaps.ending.font },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 2, outlineColor: '000000', marginH: Math.round(size.width * 0.12) },
      }));
    }
    return elements.filter(Boolean);
  }

  const meta = clip.meta || {};
  const show = config.cards.show || {};
  // カード全体のテキストフォント既定。個別ブロックの font 未指定時のフォールバック。
  const cardFont = config.cards.font;
  const elements = [];
  if (show.index) {
    const text = `${config.cards.index.prefix || ''}${index + 1}${config.cards.index.suffix || ''}`;
    elements.push(makeTextElement({
      name: 'card-index',
      text,
      style: { ...config.cards.index, enabled: true, font: config.cards.index.font ?? cardFont },
      width: size.width,
      height: size.height,
      duration,
      overrides: { outline: 4, outlineColor: '000000', shadow: 2, shadowColor: '000000' },
    }));
  }
  if (show.title) {
    elements.push(makeTextElement({
      name: 'card-title',
      text: resolveTitleText({ clip, config, titleOverride: null }),
      style: { enabled: true, align: 'top-center', size: 0.04, color: 'FFFFFF', fade: [100, 100], font: cardFont },
      width: size.width,
      height: size.height,
      duration,
      overrides: { outline: 3, outlineColor: '000000', shadow: 2, shadowColor: '000000', marginH: Math.round(size.width * 0.08), marginV: Math.round(size.height * 0.1) },
    }));
  }
  if (show.nextSerif) {
    // カードのセリフは動画中のセリフ(config.telops.serif)を継承し、
    // config.cards.serif の指定分だけ上書きする（別々に設定できる）。
    const serifStyle = deepMerge(config.telops.serif, config.cards.serif || {});
    if (!serifStyle.font && cardFont) {
      serifStyle.font = cardFont;
    }
    const marginH = Math.round(size.width * (serifStyle.marginH ?? 0.08));
    const marginV = Math.round(size.height * (serifStyle.marginV ?? 0.08));
    elements.push(makeTextElement({
      name: 'serif',
      text: clip.data.serif || '',
      style: serifStyle,
      width: size.width,
      height: size.height,
      duration,
      overrides: { marginH, marginV, layer: 6 },
    }));
  }

  const info = [
    show.date ? formatDate(meta.uploadDate) : '',
    show.uploader ? meta.uploader : '',
    show.sourceUrl ? meta.url : '',
  ].filter(Boolean).join('  /  ');
  if (info) {
    elements.push(makeTextElement({
      name: 'card-info',
      text: info,
      style: { enabled: true, align: 'bottom-right', size: 0.026, color: 'FFFFFF' },
      width: size.width,
      height: size.height,
      duration,
      overrides: { outline: 2, outlineColor: '000000', shadow: 1, shadowColor: '000000', marginH: Math.round(size.width * 0.04), marginV: Math.round(size.height * 0.025) },
    }));
  }
  return elements.filter(Boolean);
}

// エンドスクリーン。画面ほぼいっぱいの枠を 1 つ描き、上辺の左寄りと下辺の右寄りにラベルを載せる。
// ラベルの所だけ枠線を途切れさせる。要素そのもの（動画・登録ボタン）は YouTube Studio 側で置く。
export function buildEndscreenElements({ config, size, duration }) {
  const spec = config.endcaps.ending.endscreen || {};
  const frame = spec.frame || {};
  const labelStyle = spec.label || {};
  const { width, height } = size;
  const x0 = Math.round(width * (frame.x ?? 0.03));
  const y0 = Math.round(height * (frame.y ?? 0.08));
  const x1 = Math.round(width * ((frame.x ?? 0.03) + (frame.width ?? 0.94)));
  const y1 = Math.round(height * ((frame.y ?? 0.08) + (frame.height ?? 0.84)));
  const thickness = Math.max(1, Math.round(height * (frame.thickness ?? 0.008)));
  const inset = Math.round(width * (frame.labelInset ?? 0.03));
  const gap = Math.round(width * (frame.labelGap ?? 0.01));
  const fs = Math.round(height * (labelStyle.size ?? 0.06));
  // 枠線を途切れさせる幅。elementTextRect の推定（全角 1 字 = fs）は QC 向けに広めなので使わず、
  // libass で Hiragino を描いたときの実測（全角 1 字 ≈ fs × 0.66）から求める。
  const glyphRatio = Number(frame.glyphRatio ?? 0.66);
  const labelWidth = (text) => Math.round([...String(text)].reduce((sum, ch) => sum + charWidth(ch), 0) * fs * glyphRatio);
  const style = {
    enabled: true,
    size: fs,
    color: labelStyle.color || 'FFFFFF',
    font: labelStyle.font ?? config.endcaps.ending.font,
    bold: labelStyle.bold ?? false,
    shadow: labelStyle.shadow ?? 0,
    outlines: labelStyle.outlines,
  };

  // 文字の上下中央を枠線に合わせる。\an7 / \an3 の基準は行の上端 / 下端なので fs の半分ずらす。
  const top = spec.labels?.top
    ? makeTextElement({
        name: 'endscreen-top',
        text: spec.labels.top,
        style: { ...style, align: 'top-left' },
        width,
        height,
        duration,
        overrides: { marginH: x0 + inset, marginV: Math.round(y0 - fs / 2) },
      })
    : null;
  const bottom = spec.labels?.bottom
    ? makeTextElement({
        name: 'endscreen-bottom',
        text: spec.labels.bottom,
        style: { ...style, align: 'bottom-right' },
        width,
        height,
        duration,
        overrides: { marginH: width - x1 + inset, marginV: Math.round(height - y1 - fs / 2) },
      })
    : null;

  const color = frame.color || 'FFFFFF';
  const hLine = (from, to, y) => (to > from ? [{ x: from, y, width: to - from, height: thickness, color }] : []);
  // 上のラベルは左端（x0 + inset）から、下のラベルは右端（x1 - inset）までに描かれる。
  const topFrom = x0 + inset;
  const topTo = topFrom + (top ? labelWidth(top.text) : 0);
  const bottomTo = x1 - inset;
  const bottomFrom = bottomTo - (bottom ? labelWidth(bottom.text) : 0);
  const shapes = [
    ...(top ? [...hLine(x0, topFrom - gap, y0), ...hLine(topTo + gap, x1, y0)] : hLine(x0, x1, y0)),
    ...(bottom
      ? [...hLine(x0, bottomFrom - gap, y1 - thickness), ...hLine(bottomTo + gap, x1, y1 - thickness)]
      : hLine(x0, x1, y1 - thickness)),
    { x: x0, y: y0, width: thickness, height: y1 - y0, color },
    { x: x1 - thickness, y: y0, width: thickness, height: y1 - y0, color },
  ];

  return [
    { name: 'endscreen-frame', text: '', shapes, boxLayer: 2 },
    top,
    bottom,
  ].filter(Boolean);
}

function makeMatomeTitle(config, firstClip) {
  const categories = config.select.categories?.length ? `${config.select.categories.join('・')}まとめ` : null;
  return categories || stripEmoji(firstClip?.meta?.title || 'まとめ');
}

// カードの映像グラフ。[v] を作るところまでで、音声には触らない。
// 静止画プレビューはこれだけを使い、本番は音声グラフを足して 1 本の filter_complex にする。
export function buildCardVideoGraph({ kind, clips, assPath, config, size, duration, thumbnail }) {
  const background = cardBackground({ kind, clips, config, size, duration });
  const inputs = [...background.args];

  let inputIndex = 1;
  const hasThumb = Boolean(thumbnail && fs.existsSync(thumbnail));
  if (hasThumb) {
    inputs.push('-loop', '1', '-t', String(duration), '-i', thumbnail);
    inputIndex++;
  }

  const filters = [`[0:v]${background.videoFilter}[bg0]`];
  let videoLabel = 'bg0';
  if (hasThumb) {
    const thumbWidth = Number(config.cards.thumbnail.width) || Math.round(size.width * 0.6);
    const thumbY = Number(config.cards.thumbnail.y) || Math.round(size.height * 0.25);
    filters.push(`[1:v]scale=${thumbWidth}:-1:force_original_aspect_ratio=decrease,setsar=1[thumb]`);
    filters.push(`[bg0][thumb]overlay=(W-w)/2:${thumbY}[bg1]`);
    videoLabel = 'bg1';
  }
  // JPEG サムネ overlay 由来の full-range(yuvj420p) を limited-range(yuv420p) に正規化し、
  // クリップ側の pix_fmt と揃えて concat -c copy の高速経路を維持する。
  filters.push(`[${videoLabel}]${subtitlesFilter(assPath, config.fontsDir)},scale=out_range=tv,format=yuv420p[v]`);

  return { inputs, filters, inputCount: inputIndex, hasThumb, background };
}

// カードの音声グラフ。SE が無ければ無音を敷いて concat の署名を揃える。エンドスクリーンは常に無音。
function buildCardAudioGraph({ kind, config, duration, audioIndex }) {
  const silent = kind === 'ending' && isEndscreen(config);
  const sePath = !silent && config.cards.se?.enabled ? optionalAsset(config.cards.se.file, 'カードSE') : null;
  const inputs = sePath
    ? ['-i', sePath]
    : ['-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo'];

  const fadeOut = Math.max(0, Number(config.cards.se?.fadeOut || 0));
  const fadeStart = Math.max(0, duration - fadeOut);
  const filters = [`[${audioIndex}:a]atrim=0:${duration}`];
  if (fadeOut > 0) {
    filters.push(`afade=t=out:st=${fadeStart}:d=${fadeOut}`);
  }
  filters.push('aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=0:${duration}[a]`);

  return { inputs, filter: filters.join(',') };
}

export function buildCardCommand({ kind, clips, assPath, outPath, config, size, duration, thumbnail }) {
  const video = buildCardVideoGraph({ kind, clips, assPath, config, size, duration, thumbnail });
  const audio = buildCardAudioGraph({ kind, config, duration, audioIndex: video.inputCount });

  return [
    '-y',
    ...video.inputs,
    ...audio.inputs,
    '-filter_complex', [...video.filters, audio.filter].join(';'),
    '-map', '[v]',
    '-map', '[a]',
    ...encodeArgs(config),
    outPath,
  ];
}

// カードの背景。エンドスクリーンで background.type が lastClip なら、最後のクリップの最終フレームを
// ぼかして暗くした静止画にする。ソースが無ければ通常のカード背景へ戻す（requested で元の指定を残す）。
function cardBackground({ kind, clips, config, size, duration }) {
  if (kind !== 'ending' || !isEndscreen(config)) {
    return backgroundInput(config, size, duration);
  }
  const bg = config.endcaps.ending.endscreen?.background || {};
  if (bg.type !== 'lastClip') {
    return backgroundInput(config, size, duration);
  }
  const last = clips?.at(-1);
  const source = last ? clipSourcePathFor(last, config) : null;
  if (!source || !fs.existsSync(source)) {
    return { ...backgroundInput(config, size, duration), requested: 'lastClip' };
  }
  return {
    kind: 'lastClip',
    requested: 'lastClip',
    path: source,
    // 入力シークで末尾 0.5 秒だけを読み、その先頭 1 枚を duration 秒ぶん複製する。
    args: ['-sseof', '-0.5', '-i', source],
    videoFilter: lastFrameBackgroundFilter({ bg, size, duration }),
  };
}

export function lastFrameBackgroundFilter({ bg, size, duration }) {
  const blur = Number(bg.blur ?? 40);
  const brightness = Number(bg.brightness ?? -0.08);
  return [
    'trim=end_frame=1',
    'setpts=PTS-STARTPTS',
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    ...(blur > 0 ? [`gblur=sigma=${blur}`] : []),
    ...(brightness !== 0 ? [`eq=brightness=${brightness}`] : []),
    `tpad=stop_mode=clone:stop_duration=${duration}`,
    `fps=${size.fps}`,
    `trim=duration=${duration}`,
  ].join(',');
}

function backgroundInput(config, size, duration) {
  const bg = config.cards.background || {};
  const normalize = `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1,fps=${size.fps}`;
  if (bg.type === 'video') {
    const video = optionalAsset(bg.video, 'カード背景動画');
    if (video) {
      return {
        kind: 'video',
        path: video,
        args: ['-stream_loop', '-1', '-t', String(duration), '-i', video],
        videoFilter: normalize,
      };
    }
  }
  if (bg.type === 'image') {
    const image = optionalAsset(bg.image, 'カード背景画像');
    if (image) {
      return {
        kind: 'image',
        path: image,
        args: ['-loop', '1', '-t', String(duration), '-i', image],
        videoFilter: normalize,
      };
    }
  }
  if (bg.type === 'gradient') {
    const c0 = (bg.gradient?.c0 || bg.color || '0E7A34').replace(/^#/, '');
    const c1 = (bg.gradient?.c1 || bg.color || '064D20').replace(/^#/, '');
    return {
      kind: 'gradient',
      path: null,
      args: ['-f', 'lavfi', '-t', String(duration), '-i', `gradients=s=${size.width}x${size.height}:r=${size.fps}:c0=0x${c0}:c1=0x${c1}:nb_colors=2`],
      videoFilter: `setsar=1,fps=${size.fps}`,
    };
  }

  const color = (bg.color || '0E7A34').replace(/^#/, '');
  return {
    kind: 'color',
    path: null,
    args: ['-f', 'lavfi', '-t', String(duration), '-i', `color=c=0x${color}:s=${size.width}x${size.height}:r=${size.fps}`],
    videoFilter: `setsar=1,fps=${size.fps}`,
  };
}

function cardSourcePath(config) {
  const bg = config.cards.background || {};
  if (bg.type === 'video' && bg.video) return resolveProjectPath(bg.video);
  if (bg.type === 'image' && bg.image) return resolveProjectPath(bg.image);
  return null;
}
