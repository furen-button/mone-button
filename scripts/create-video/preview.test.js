import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildAss,
  elementRect,
  elementTextLineRects,
  elementTextRect,
  fontSize,
} from './ass.js';
import { buildClipElements, planClipRender } from './clip.js';
import { DEFAULTS, deepMerge } from './config.js';
import { buildZoomFilterComplex } from './effects.js';
import { subtitlesFilter } from './ffmpeg.js';
import {
  collectStillWarnings,
  defaultStillTime,
  elementRects,
  parseAt,
  parseStillTarget,
  stillFfmpegArgs,
  stillOutPath,
  stillPreroll,
} from './preview.js';

const size = { width: 1920, height: 1080, fps: 30 };
const tools = { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' };

function config(override = {}) {
  return { ...deepMerge(DEFAULTS, { output: { resolution: '1920x1080' }, ...override }), __meta: { cli: {} } };
}

function clip(override = {}) {
  return {
    base: '2024-07-13-gr9WJDYS_u0-000089-000100',
    file: '2024-07-13-gr9WJDYS_u0-000089-000100.json',
    videoId: 'gr9WJDYS_u0',
    data: { serif: 'こんにちは\nもねです', ...override.data },
    startTime: 89,
    endTime: 100,
    duration: 11,
    meta: { uploadDate: '20240713', title: '配信タイトル' },
    ...override,
  };
}

function baseFilters(cfg = config()) {
  return [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${size.fps}`,
  ];
}

describe('parseAt', () => {
  it('秒数とパーセントと既定値を読む', () => {
    assert.equal(parseAt('2.05', { duration: 10, fps: 30 }), 2.05);
    assert.equal(parseAt('50%', { duration: 10, fps: 30 }), 5);
    assert.equal(parseAt(undefined, { duration: 10, fps: 30 }), defaultStillTime(10));
  });

  it('負数と NaN は拒否する', () => {
    assert.throws(() => parseAt('-1', { duration: 10, fps: 30 }), /at は/u);
    assert.throws(() => parseAt('x', { duration: 10, fps: 30 }), /at は/u);
  });
});

describe('parseStillTarget', () => {
  it('拡張子を剥がし、選択順とカードを識別する', () => {
    assert.deepEqual(parseStillTarget('clip-a.json'), { kind: 'clip', base: 'clip-a' });
    assert.deepEqual(parseStillTarget('clip-a.mp4'), { kind: 'clip', base: 'clip-a' });
    assert.deepEqual(parseStillTarget('#12'), { kind: 'clip', position: 12 });
    assert.deepEqual(parseStillTarget('card:clip-a'), { kind: 'card', base: 'clip-a' });
  });
});

describe('stillOutPath', () => {
  it('config base ごとの preview ディレクトリへ出す', () => {
    assert.equal(
      stillOutPath({ configPath: '/repo/scripts/create-video/config-matome-01.json', base: 'clip-a', at: 2.05, root: '/repo' }),
      path.join('/repo', 'cache/createVideo/preview/config-matome-01/clip-a-t2.050.png'),
    );
  });
});

describe('stillFfmpegArgs', () => {
  it('-ss は -i より後で、静止画出力だけを指定する', () => {
    const args = stillFfmpegArgs({ sourceMp4: 'in.mp4', graph: { vf: 'scale=1920:1080' }, at: 2.05, out: 'out.png' });
    assert.ok(args.indexOf('-ss') > args.indexOf('-i'));
    assert.ok(args.includes('-an'));
    assert.equal(args[args.indexOf('-frames:v') + 1], '1');
    assert.equal(args.includes('libx264'), false);
  });

  it('preroll があれば vf の先頭に trim を置き、complex には付けない', () => {
    const vfArgs = stillFfmpegArgs({ sourceMp4: 'in.mp4', graph: { vf: 'scale=1920:1080' }, at: 2.05, out: 'out.png', preroll: 1.5 });
    assert.equal(vfArgs[vfArgs.indexOf('-vf') + 1], 'trim=start=1.5000,scale=1920:1080,format=yuv420p');
    const noPreroll = stillFfmpegArgs({ sourceMp4: 'in.mp4', graph: { vf: 'scale=1920:1080' }, at: 0.2, out: 'out.png', preroll: 0 });
    assert.equal(noPreroll[noPreroll.indexOf('-vf') + 1], 'scale=1920:1080,format=yuv420p');
    const complexArgs = stillFfmpegArgs({ sourceMp4: 'in.mp4', graph: { complex: '[0:v]scale=1920:1080[v]' }, at: 2.05, out: 'out.png', preroll: 1.5 });
    assert.equal(complexArgs[complexArgs.indexOf('-filter_complex') + 1], '[0:v]scale=1920:1080[v];[v]format=yuv420p[out]');
  });

  it('stillPreroll は 0.5 秒手前を 1/fps のグリッドへ切り下げ、負にはしない', () => {
    assert.equal(stillPreroll(2.05, 30), Math.floor(1.55 * 30) / 30);
    assert.equal(stillPreroll(0.3, 30), 0);
    assert.equal(stillPreroll(2.05, 0), Math.floor(1.55 * 30) / 30);
  });

  it('postFilters 付き complex は [v] の後へ足して [out] を map する', () => {
    const args = stillFfmpegArgs({
      sourceMp4: 'in.mp4',
      graph: { complex: '[0:v]scale=1920:1080[v]' },
      at: 2.05,
      out: 'out.png',
      postFilters: ['scale=480:-2', 'drawtext=text=test'],
    });
    assert.equal(args[args.indexOf('-filter_complex') + 1], '[0:v]scale=1920:1080[v];[v]format=yuv420p,scale=480:-2,drawtext=text=test[out]');
    assert.equal(args[args.indexOf('-map') + 1], '[out]');
  });
});

describe('collectStillWarnings', () => {
  it('低解像度・preview skip・fallback を warning code にする', () => {
    const warnings = collectStillWarnings({
      config: config({ effects: { zoom: { enabled: true } } }),
      plans: { zoom: false, avoid: false, enhance: true },
      source: { path: 'x.mp4', kind: 'existing', width: 256, height: 144, fps: 30, duration: 11 },
      size,
      zoom: null,
      avoid: null,
      enhance: { applied: false, fallback: true, reason: 'libplacebo' },
      at: 2.05,
      requestedAt: 2.05,
      clip: clip(),
    });
    assert.deepEqual(
      warnings.map((warning) => warning.code),
      ['source_upscaled', 'zoom_skipped', 'avoid_face_skipped', 'enhance_fallback'],
    );
  });
});

describe('planClipRender', () => {
  it('plans 全 false なら従来の buildClipElements → buildAss と同じ ASS と vf を返す', async () => {
    const cfg = config();
    const item = clip();
    const assPath = '/tmp/clip.ass';
    const plan = await planClipRender({
      tools,
      clip: item,
      index: 0,
      total: 3,
      config: cfg,
      size,
      workDir: '/tmp',
      sourceMp4: 'in.mp4',
      assPath,
      plans: { zoom: false, avoid: false, enhance: false },
      log: () => {},
    });
    const expectedElements = buildClipElements({ clip: item, index: 0, total: 3, config: cfg, size, titleOverride: null });
    assert.equal(plan.ass, buildAss(expectedElements, { width: size.width, height: size.height, font: cfg.font }));
    assert.equal(plan.graph.vf, [...baseFilters(cfg), subtitlesFilter(assPath, cfg.fontsDir)].join(','));
  });

  it('punch zoom を注入すると本番の complex builder そのものを使う', async () => {
    const cfg = config();
    const item = clip();
    const assPath = '/tmp/clip.ass';
    const zoom = { at: 2, scale: 1.3, focus: { x: 0.5, y: 0.5 }, mode: 'punch' };
    const plan = await planClipRender({
      tools,
      clip: item,
      index: 0,
      total: 3,
      config: cfg,
      size,
      workDir: '/tmp',
      sourceMp4: 'in.mp4',
      assPath,
      plans: { zoom, avoid: false, enhance: false },
      log: () => {},
    });
    const subFilter = subtitlesFilter(assPath, cfg.fontsDir);
    assert.equal(plan.graph.complex, buildZoomFilterComplex({ baseFilters: baseFilters(cfg), subFilter, zoom, size, upscale: null }));
  });

  it('full zoom を注入すると vf に crop を含める', async () => {
    const plan = await planClipRender({
      tools,
      clip: clip(),
      index: 0,
      total: 3,
      config: config(),
      size,
      workDir: '/tmp',
      sourceMp4: 'in.mp4',
      assPath: '/tmp/clip.ass',
      plans: { zoom: { at: 0, scale: 1.3, focus: { x: 0.5, y: 0.5 }, mode: 'full' }, avoid: false, enhance: false },
      log: () => {},
    });
    assert.match(plan.graph.vf, /crop=/u);
  });
});

describe('elementRects', () => {
  it('ASS の矩形関数と同じ順序で rect/textRect/lineRects を返す', () => {
    const cfg = config();
    const elements = buildClipElements({ clip: clip(), index: 0, total: 3, config: cfg, size, titleOverride: null });
    const expected = structuredClone(elements).map((el) => {
      const rect = elementRect(el, size.width, size.height);
      const textRect = elementTextRect(el, size.width, size.height);
      const lineRects = elementTextLineRects(el, size.width, size.height);
      return {
        name: el.name,
        text: el.text,
        lines: String(el.text || '').split(/\r?\n|\\N/u),
        fontSize: fontSize(el.size, size.height),
        rect,
        textRect,
        lineRects,
      };
    });
    assert.deepEqual(elementRects(structuredClone(elements), size), expected);
  });
});
