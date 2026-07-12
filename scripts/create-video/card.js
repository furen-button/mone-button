import fs from 'fs';
import path from 'path';
import { buildAss, formatDate, makeTextElement, stripEmoji } from './ass.js';
import { cacheThumbnail, optionalAsset } from './assets.js';
import { encodeArgs, subtitlesFilter } from './ffmpeg.js';
import { execFileSync } from 'child_process';

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
  const safeKind = kind === 'clip' ? `card-${String(index).padStart(4, '0')}` : kind;
  const assPath = path.join(workDir, `${safeKind}.ass`);
  const outPath = path.join(workDir, `${safeKind}.mp4`);
  const elements = buildCardElements({ kind, clip, clips, index, total, config, size, title, duration });
  fs.writeFileSync(assPath, buildAss(elements, { width: size.width, height: size.height, font: config.font }));

  const command = buildCardCommand({ tools, assPath, outPath, config, size, duration, thumbnail });
  execFileSync(tools.ffmpeg, command, { stdio: 'inherit' });
  return outPath;
}

function buildCardElements({ kind, clip, clips, index, total, config, size, title, duration }) {
  if (kind === 'opening') {
    const first = clips[0];
    const mainTitle = title || config.endcaps.opening.title || makeMatomeTitle(config, first);
    const subtitle = (config.endcaps.opening.subtitle || '全{n}クリップ').replaceAll('{n}', String(total));
    return [
      makeTextElement({
        name: 'opening-title',
        text: mainTitle,
        style: { enabled: true, align: 'center', size: 0.085, color: 'FFFFFF' },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 4, outlineColor: '000000', shadow: 2, shadowColor: '000000', marginH: Math.round(size.width * 0.1) },
      }),
      makeTextElement({
        name: 'opening-subtitle',
        text: subtitle,
        style: { enabled: true, align: 'bottom-center', size: 0.05, color: 'FFFFFF' },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 3, outlineColor: '000000', shadow: 2, shadowColor: '000000' },
      }),
    ].filter(Boolean);
  }

  if (kind === 'ending') {
    const text = config.endcaps.ending.text || 'ご視聴ありがとうございました';
    const elements = [
      makeTextElement({
        name: 'ending-text',
        text,
        style: { enabled: true, align: 'center', size: 0.075, color: 'FFFFFF' },
        width: size.width,
        height: size.height,
        duration,
        overrides: { outline: 4, outlineColor: '000000', shadow: 2, shadowColor: '000000', marginH: Math.round(size.width * 0.1) },
      }),
    ];
    if (config.endcaps.ending.listClips) {
      elements.push(makeTextElement({
        name: 'ending-list',
        text: clips.slice(0, 8).map((item, i) => `${i + 1}. ${item.data.serif || item.base}`).join('\n'),
        style: { enabled: true, align: 'bottom-center', size: 0.03, color: 'FFFFFF' },
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
  const elements = [];
  if (show.index) {
    const text = `${config.cards.index.prefix || ''}${index + 1}${config.cards.index.suffix || ''}`;
    elements.push(makeTextElement({
      name: 'card-index',
      text,
      style: { ...config.cards.index, enabled: true },
      width: size.width,
      height: size.height,
      duration,
      overrides: { outline: 4, outlineColor: '000000', shadow: 2, shadowColor: '000000' },
    }));
  }
  if (show.title) {
    elements.push(makeTextElement({
      name: 'card-title',
      text: stripEmoji(meta.title || ''),
      style: { enabled: true, align: 'top-center', size: 0.04, color: 'FFFFFF', fade: [100, 100] },
      width: size.width,
      height: size.height,
      duration,
      overrides: { outline: 3, outlineColor: '000000', shadow: 2, shadowColor: '000000', marginH: Math.round(size.width * 0.08), marginV: Math.round(size.height * 0.1) },
    }));
  }
  if (show.nextSerif) {
    elements.push(makeTextElement({
      name: 'serif',
      text: clip.data.serif || '',
      style: config.telops.serif,
      width: size.width,
      height: size.height,
      duration,
      overrides: { marginH: Math.round(size.width * 0.08), marginV: Math.round(size.height * 0.08), layer: 6 },
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

function makeMatomeTitle(config, firstClip) {
  const categories = config.select.categories?.length ? `${config.select.categories.join('・')}まとめ` : null;
  return categories || stripEmoji(firstClip?.meta?.title || 'まとめ');
}

function buildCardCommand({ assPath, outPath, config, size, duration, thumbnail }) {
  const args = ['-y'];
  const background = backgroundInput(config, size, duration);
  args.push(...background.args);

  let inputIndex = 1;
  const hasThumb = Boolean(thumbnail && fs.existsSync(thumbnail));
  if (hasThumb) {
    args.push('-loop', '1', '-t', String(duration), '-i', thumbnail);
    inputIndex++;
  }

  const sePath = config.cards.se?.enabled ? optionalAsset(config.cards.se.file, 'カードSE') : null;
  const audioIndex = inputIndex;
  if (sePath) {
    args.push('-i', sePath);
  } else {
    args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo');
  }

  const filters = [
    `[0:v]${background.videoFilter}[bg0]`,
  ];
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

  const fadeOut = Math.max(0, Number(config.cards.se?.fadeOut || 0));
  const fadeStart = Math.max(0, duration - fadeOut);
  const audioFilters = [`[${audioIndex}:a]atrim=0:${duration}`];
  if (fadeOut > 0) audioFilters.push(`afade=t=out:st=${fadeStart}:d=${fadeOut}`);
  audioFilters.push('aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=0:${duration}[a]`);
  filters.push(audioFilters.join(','));

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[v]',
    '-map', '[a]',
    ...encodeArgs(config),
    outPath,
  );
  return args;
}

function backgroundInput(config, size, duration) {
  const bg = config.cards.background || {};
  const normalize = `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1,fps=${size.fps}`;
  if (bg.type === 'video') {
    const video = optionalAsset(bg.video, 'カード背景動画');
    if (video) {
      return {
        args: ['-stream_loop', '-1', '-t', String(duration), '-i', video],
        videoFilter: normalize,
      };
    }
  }
  if (bg.type === 'image') {
    const image = optionalAsset(bg.image, 'カード背景画像');
    if (image) {
      return {
        args: ['-loop', '1', '-t', String(duration), '-i', image],
        videoFilter: normalize,
      };
    }
  }
  if (bg.type === 'gradient') {
    const c0 = (bg.gradient?.c0 || bg.color || '0E7A34').replace(/^#/, '');
    const c1 = (bg.gradient?.c1 || bg.color || '064D20').replace(/^#/, '');
    return {
      args: ['-f', 'lavfi', '-t', String(duration), '-i', `gradients=s=${size.width}x${size.height}:r=${size.fps}:c0=0x${c0}:c1=0x${c1}:nb_colors=2`],
      videoFilter: `setsar=1,fps=${size.fps}`,
    };
  }

  const color = (bg.color || '0E7A34').replace(/^#/, '');
  return {
    args: ['-f', 'lavfi', '-t', String(duration), '-i', `color=c=0x${color}:s=${size.width}x${size.height}:r=${size.fps}`],
    videoFilter: `setsar=1,fps=${size.fps}`,
  };
}
