#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import {
  elementRect,
  elementTextLineRects,
  elementTextRect,
  fontSize,
} from './ass.js';
import {
  buildClipElements,
  clipSourcePathFor,
  planClipRender,
  resolveClipSource,
} from './clip.js';
import {
  buildCardVideoGraph,
  endcapVideoFilter,
  endcapVideoPath,
  planCardRender,
} from './card.js';
import { cacheThumbnail } from './assets.js';
import { zoomCropRect } from './effects.js';
import { loadConfig, outputSize, parseArgs, projectRoot } from './config.js';
import { collectClips } from './select.js';
import { resolveFfmpeg } from './ffmpeg.js';
import { labelDrawtext, resolveContactFont, tileFrames } from './qc/contact.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const defaultTimeoutMs = 30000;
// 先読みの長さ（秒）。この分だけ手前から本番フィルタ列に流し、それより前のフレームはデコードだけで捨てる。
const prerollLeadSec = 0.5;

// resolveFfmpeg は libass 対応の確認に ffmpeg を 1 回起動する（約 70ms）。プロセス内では結果が変わらないので 1 回だけ解決する。
let cachedTools = null;
function cachedFfmpegTools() {
  cachedTools ??= resolveFfmpeg();
  return cachedTools;
}

export class StillAbortedError extends Error {
  constructor(message = '静止画プレビューを中断しました。') {
    super(message);
    this.name = 'StillAbortedError';
  }
}

export async function renderStill(request) {
  const target = parseStillTarget(request.still);
  if (target.kind !== 'clip') {
    return renderCardStill(request, target);
  }

  const started = Date.now();
  const log = request.log || (() => {});
  const context = loadStillContext(request);
  const { config, size, index, total, clip } = context;
  const sourceMp4 = resolveClipSource(clip, config, { allowDownload: false, log });
  const plans = normalizePlans(request.plans, config.__meta?.cli || {});
  if (!sourceMp4) {
    const expected = clipSourcePathFor(clip, config);
    const warnings = collectStillWarnings({
      config,
      plans,
      source: { missing: true, path: expected, kind: config.source },
      size,
      zoom: null,
      avoid: null,
      enhance: null,
      at: null,
      requestedAt: null,
      clip,
    });
    const err = new Error(`source_missing: ソース mp4 が見つかりません: ${expected}`);
    err.code = 'source_missing';
    err.warnings = warnings;
    throw err;
  }

  const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
  // ffprobe から先はすべて try の中に置く。中断（AbortSignal）は ffprobe 中にも来るので、
  // ここで包まないと StillAbortedError にならず素の AbortError が漏れる。
  let workDir = null;
  let tmpOut = null;

  try {
    const tools = request.tools || cachedFfmpegTools();
    const source = await probeStillSource({
      ffprobe: tools.ffprobe,
      sourceMp4,
      kind: config.source,
      signal: request.signal,
      timeoutMs,
    });
    const duration = positiveDuration(clip.duration, source.duration);
    const requestedAt = parseAt(request.at, { duration, fps: size.fps });
    const at = clampAt(requestedAt, {
      duration: Math.min(duration, positiveDuration(source.duration, duration)),
      fps: size.fps,
    });
    const out = resolveStillOut(request.out, {
      configPath: config.__meta?.configPath,
      base: clip.base,
      at,
    });
    const assPath = stillAssPath({
      out,
      base: clip.base,
      at,
      sourceMp4,
      config,
      clipPatch: request.clipPatch,
      plans,
      index,
      total,
    });
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'still-'));
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
      titleOverride: config.titleOverride || null,
      plans,
      probe: source,
      log,
    });
    fs.mkdirSync(path.dirname(assPath), { recursive: true });
    fs.writeFileSync(assPath, plan.ass);

    fs.mkdirSync(path.dirname(out), { recursive: true });
    tmpOut = `${out}.tmp.png`;
    fs.rmSync(tmpOut, { force: true });
    const args = stillFfmpegArgs({
      sourceMp4,
      graph: plan.graph,
      at,
      out: tmpOut,
      postFilters: request.postFilters || [],
      preroll: stillPreroll(at, size.fps),
    });
    await runFfmpegStill({
      ffmpeg: tools.ffmpeg,
      args,
      signal: request.signal,
      timeoutMs,
      tmpOut,
    });
    await fs.promises.rename(tmpOut, out);

    const warnings = collectStillWarnings({
      config,
      plans,
      source,
      size,
      zoom: plan.zoom,
      avoid: plan.avoid,
      enhance: plan.enhance,
      at,
      requestedAt,
      clip,
    });
    const visibleZoom = plan.zoom || (zoomPreviewRequested(config, clip) && plans.zoom === false ? { skipped: 'preview' } : null);
    const visibleAvoid = plan.avoid || (avoidPreviewRequested(config, clip) && plans.avoid === false ? { skipped: 'preview' } : null);

    return {
      ok: true,
      out,
      assPath,
      at,
      requestedAt,
      index,
      total,
      clip: { base: clip.base, videoId: clip.videoId, file: clip.file },
      size,
      source,
      zoom: visibleZoom,
      avoidFace: visibleAvoid,
      enhance: plan.enhance,
      elements: elementRects(plan.elements, size),
      overlays: {
        face: plan.avoid?.face,
        crop: plan.zoom && !plan.zoom.skip ? zoomCropRect({ zoom: plan.zoom, size }) : undefined,
      },
      warnings,
      key: stillKey({ ass: plan.ass, args, source }),
      ms: Date.now() - started,
    };
  } catch (err) {
    if (tmpOut) {
      fs.rmSync(tmpOut, { force: true });
    }
    if (isAbortError(err, request.signal)) {
      throw new StillAbortedError();
    }
    if (err.stderr !== undefined) {
      const message = firstLine(err.stderr) || firstLine(err.message);
      throw new Error(`静止画の書き出しに失敗しました: ${message}`);
    }
    throw err;
  } finally {
    if (workDir && process.env.KEEP_WORKDIR) {
      log(`🔧 KEEP_WORKDIR: 中間ファイルを保持 ${workDir}`);
    } else if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

export async function buildStillAss(request) {
  const target = parseStillTarget(request.still);
  if (target.kind !== 'clip') {
    return buildCardStillAss(request, target);
  }

  const context = loadStillContext(request);
  const { config, size, index, total, clip } = context;
  const assPath = path.join(os.tmpdir(), `${clip.base}.ass`);
  const plan = await planClipRender({
    tools: request.tools || { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' },
    clip,
    index,
    total,
    config,
    size,
    workDir: os.tmpdir(),
    sourceMp4: '',
    assPath,
    titleOverride: config.titleOverride || null,
    plans: normalizeAssPlans(request.plans),
    log: request.log || (() => {}),
  });
  return {
    ok: true,
    ass: plan.ass,
    index,
    total,
    clip,
    size,
    elements: plan.elements,
    warnings: collectStillWarnings({
      config,
      plans: normalizeAssPlans(request.plans),
      source: null,
      size,
      zoom: plan.zoom,
      avoid: plan.avoid,
      enhance: plan.enhance,
      at: null,
      requestedAt: null,
      clip,
    }),
  };
}

export async function renderSheet(request) {
  const started = Date.now();
  const frames = request.frames !== undefined && request.frames !== null
    ? parsePositiveInt(request.frames, '--frames')
    : null;
  const context = frames
    ? loadStillContext(request)
    : loadSheetContext(request);
  const { config, size } = context;
  const tools = request.tools || cachedFfmpegTools();
  const options = config.qc?.contact || {};
  const columns = parsePositiveInt(request.columns ?? options.columns ?? 4, '--sheet');
  const cellWidth = even(Number(request.cellWidth ?? options.cellWidth ?? 480));
  const fontFile = resolveContactFont(options);
  const items = frames
    ? frameSheetItems({ context, frames })
    : clipSheetItems(context.clips, request.at);
  if (items.length === 0) {
    throw new Error('静止画シートの対象クリップがありません。');
  }
  const rows = Math.ceil(items.length / columns);
  const out = resolveSheetOut(request.out, {
    configPath: config.__meta?.configPath,
    name: frames ? `${context.clip.base}-frames${frames}.png` : `sheet-${items.length}x${columns}.png`,
  });
  const sheetId = sheetKey({
    argv: request.argv || [],
    items,
    columns,
    cellWidth,
    out,
  });
  const cellDir = path.join(path.dirname(out), '.cells', sheetId);
  fs.rmSync(cellDir, { recursive: true, force: true });
  fs.mkdirSync(cellDir, { recursive: true });

  const cells = await mapWithConcurrency(
    items,
    Math.max(1, Number(request.concurrency ?? 4)),
    async (item, position) => renderSheetCell({
      request,
      tools,
      item,
      position,
      cellDir,
      cellWidth,
      fontFile,
      size,
    }),
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  tileFrames({
    ffmpeg: tools.ffmpeg,
    frameDir: cellDir,
    columns,
    rows,
    outPath: out,
    timeoutMs: 120000,
  });
  const failed = unique(cells.filter((cell) => !cell.ok).map((cell) => cell.base));
  return {
    ok: failed.length === 0,
    out,
    columns,
    rows,
    cellWidth,
    cells,
    failed,
    ms: Date.now() - started,
  };
}

export function parseAt(value, { duration, fps }) {
  if (value === undefined || value === null || value === true || value === false) {
    return defaultStillTime(duration);
  }
  const raw = String(value).trim();
  const parsed = raw.endsWith('%')
    ? (Number(raw.slice(0, -1)) / 100) * Number(duration)
    : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`at は 0 以上の秒数または N% で指定してください: ${value}`);
  }
  if (!Number.isFinite(Number(fps)) || Number(fps) <= 0) {
    throw new Error(`fps が不正です: ${fps}`);
  }
  return parsed;
}

export function defaultStillTime(duration) {
  const d = Number(duration) || 0;
  return Math.max(0.2, Math.min(d / 2, d - 0.2));
}

export function parseStillTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error('--still を指定してください。');
  }
  if (raw === 'opening') {
    return { kind: 'opening' };
  }
  if (raw === 'ending') {
    return { kind: 'ending' };
  }
  if (raw.startsWith('card:')) {
    const value = raw.slice('card:'.length).trim();
    const cardPosition = value.match(/^#(\d+)$/u);
    if (cardPosition) {
      return { kind: 'card', position: Number(cardPosition[1]) };
    }
    return { kind: 'card', base: stripClipExt(value) };
  }
  const position = raw.match(/^#(\d+)$/u);
  if (position) {
    return { kind: 'clip', position: Number(position[1]) };
  }
  return { kind: 'clip', base: stripClipExt(path.basename(raw)) };
}

export function stillOutPath({ configPath, base, at, root = projectRoot }) {
  return path.join(previewDirForConfig(configPath, root), `${base}-t${Number(at).toFixed(3)}.png`);
}

// 出力シーク（-ss を -i の後に置く）は t までの全フレームが本番フィルタ列（1080p への scale と libass）を通るので、
// t の手前 prerollLeadSec 秒だけを 1/fps のグリッドに切り下げた位置を返す。ここまでは trim で捨て、デコードだけで済ませる。
export function stillPreroll(at, fps, lead = prerollLeadSec) {
  const rate = Number(fps) > 0 ? Number(fps) : 30;
  return Math.max(0, Math.floor((Number(at) - lead) * rate) / rate);
}

export function stillFfmpegArgs({ sourceMp4, graph, at, out, postFilters = [], preroll = 0 }) {
  // 本番動画は encodeArgs の -pix_fmt yuv420p を必ず通る。PNG でも同じ色差サブサンプリングを
  // 1 回挟むことで、完成セグメントから抜いたフレームとの見た目を揃える。
  const filters = ['format=yuv420p', ...postFilters.filter(Boolean)];
  const post = filters.join(',');
  // trim は pts を保つので、libass の時刻も fps フィルタのグリッド（k/fps）も本番と同じになる（PNG は md5 一致を確認済み）。
  // 入力シーク（-ss を -i の前）は copyts を付けないと libass の時刻がズレるので使わない。
  // zoom punch の filter_complex は setpts=PTS-STARTPTS で先頭を 0 に戻すため、trim を前置すると trim/concat の時刻が崩れる。そちらは従来どおり全フレームを流す。
  const prerollFilter = graph.vf && Number(preroll) > 0 ? `trim=start=${Number(preroll).toFixed(4)}` : null;
  const filterArgs = graph.complex
    ? [
        '-filter_complex',
        `${graph.complex};[v]${post}[out]`,
        '-map',
        '[out]',
      ]
    : ['-vf', [prerollFilter, graph.vf, ...filters].filter(Boolean).join(',')];
  return [
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-y',
    '-i', sourceMp4,
    ...filterArgs,
    '-an',
    '-ss', Number(at).toFixed(3),
    '-frames:v', '1',
    '-update', '1',
    out,
  ];
}

export function collectStillWarnings({
  config,
  plans,
  source,
  size,
  zoom,
  avoid,
  enhance,
  at,
  requestedAt,
  clip,
}) {
  const warnings = [...(config.__meta?.stillWarnings || [])];
  if (source?.missing) {
    warnings.push({
      code: 'source_missing',
      message: `ソース mp4 が見つかりません: ${source.path}`,
    });
  } else if (source && (source.width < size.width || source.height < size.height)) {
    warnings.push({
      code: 'source_upscaled',
      message: `${source.width}x${source.height} < ${size.width}x${size.height}（source=${source.kind}）。--source cache で高画質キャッシュを使えます（キャッシュ済みのみ、DL しない）。`,
    });
  }
  if (zoomPreviewRequested(config, clip) && plans?.zoom === false) {
    warnings.push({
      code: 'zoom_skipped',
      message: '--zoom で反映できます（テロップ位置は不変）。',
    });
  } else if (zoom?.skip) {
    warnings.push({
      code: 'zoom_none',
      message: `ズーム計画は見送りました: ${zoom.skip}`,
    });
  }
  if (avoidPreviewRequested(config, clip) && plans?.avoid === false) {
    warnings.push({
      code: 'avoid_face_skipped',
      message: '--avoid-face で顔回避を反映できます。',
    });
  } else if (avoid?.fallback) {
    warnings.push({
      code: 'avoid_face_fallback',
      message: `顔回避はフォールバックしました: ${avoid.reason}`,
    });
  }
  if (enhance?.fallback) {
    warnings.push({
      code: 'enhance_fallback',
      message: `補正はフォールバックしました: ${enhance.reason}`,
    });
  } else if (enhance && enhance.applied === false) {
    warnings.push({
      code: 'enhance_none',
      message: `補正は見送りました: ${enhance.reason}`,
    });
  }
  if (Number.isFinite(at) && Number.isFinite(requestedAt) && Math.abs(at - requestedAt) > 0.0005) {
    warnings.push({
      code: 'at_clamped',
      message: `指定時刻 ${requestedAt.toFixed(3)}s を ${at.toFixed(3)}s に丸めました。`,
    });
  }
  return warnings;
}

export function elementRects(elements, size) {
  return elements.map((el) => {
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
}

export function stillKey({ ass, args, source }) {
  return crypto.createHash('sha1')
    .update(String(ass || ''))
    .update('\0')
    .update(JSON.stringify(args || []))
    .update('\0')
    .update(typeof source === 'string' ? source : JSON.stringify(source || {}))
    .digest('hex')
    .slice(0, 16);
}

function loadSheetContext(request) {
  const config = loadConfig(request.argv || []);
  const size = outputSize(config);
  const clips = collectClips(config);
  return { config, size, clips };
}

function clipSheetItems(clips, at) {
  return clips.map((clip, index) => ({
    index: index + 1,
    base: clip.base,
    still: clip.base,
    at,
    label: `#${index + 1}  ${clip.base}`,
  }));
}

function frameSheetItems({ context, frames }) {
  const duration = positiveDuration(context.clip.duration, context.clip.endTime - context.clip.startTime);
  return Array.from({ length: frames }, (_, index) => {
    const at = duration * ((index + 0.5) / frames);
    return {
      index: index + 1,
      base: context.clip.base,
      still: context.clip.base,
      at,
      label: `#${index + 1}  ${at.toFixed(2)}s`,
    };
  });
}

async function renderSheetCell({ request, tools, item, position, cellDir, cellWidth, fontFile, size }) {
  const framePath = path.join(cellDir, `${String(position).padStart(3, '0')}.png`);
  const postFilters = [
    ...(request.postFilters || []),
    `scale=${cellWidth}:-2`,
  ];
  if (fontFile) {
    postFilters.push(labelDrawtext(item.label, fontFile));
  }
  try {
    const result = await renderStill({
      ...request,
      tools,
      still: item.still,
      at: item.at,
      out: framePath,
      postFilters,
      timeoutMs: request.timeoutMs ?? defaultTimeoutMs,
    });
    return {
      index: item.index,
      base: item.base,
      at: result.at,
      framePath,
      ok: true,
      warnings: result.warnings,
    };
  } catch (err) {
    if (isAbortError(err, request.signal)) {
      throw new StillAbortedError();
    }
    const warnings = err.warnings || [{ code: 'render_failed', message: err.message }];
    await writeMissingCell({
      ffmpeg: tools.ffmpeg,
      framePath,
      size,
      cellWidth,
      label: `${item.label}  missing`,
      fontFile,
      signal: request.signal,
    });
    return {
      index: item.index,
      base: item.base,
      at: Number.isFinite(item.at) ? item.at : null,
      framePath,
      ok: false,
      warnings,
    };
  }
}

async function writeMissingCell({ ffmpeg, framePath, size, cellWidth, label, fontFile, signal }) {
  const height = even((cellWidth * size.height) / size.width);
  const filters = [];
  if (fontFile) {
    filters.push(labelDrawtext(label, fontFile));
  }
  await execFileAsync(ffmpeg, [
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x333333:s=${cellWidth}x${height}:d=0.1`,
    ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
    '-frames:v', '1',
    '-update', '1',
    framePath,
  ], {
    signal,
    timeout: defaultTimeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

// カード / OP / ED の静止画。クリップ経路と違ってソース mp4 が無く、背景（lavfi / 画像 / 動画）と
// サムネイルと ASS から本番と同じ入力を組み立てる。計画は card.js の planCardRender と共有する。
async function renderCardStill(request, target) {
  const started = Date.now();
  const log = request.log || (() => {});
  const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
  const tools = request.tools || cachedFfmpegTools();
  const context = await loadCardContext(request, target);
  const { config, size, clip, index, total } = context;
  const base = cardStillBase(target, clip);

  let tmpOut = null;
  try {
    // OP/ED に完成動画が指定されていれば、本番と同じくその動画から抜く。
    const endcap = context.videoPath
      ? await probeStillSource({
          ffprobe: tools.ffprobe,
          sourceMp4: context.videoPath,
          kind: 'endcap',
          signal: request.signal,
          timeoutMs,
        })
      : null;
    const duration = endcap ? positiveDuration(endcap.duration, context.duration) : context.duration;
    const requestedAt = parseAt(request.at, { duration, fps: size.fps });
    const at = clampAt(requestedAt, { duration, fps: size.fps });
    const out = resolveStillOut(request.out, { configPath: config.__meta?.configPath, base, at });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    tmpOut = `${out}.tmp.png`;
    fs.rmSync(tmpOut, { force: true });

    let plan = null;
    let assPath = null;
    let args;
    let source;
    if (endcap) {
      source = { ...endcap, kind: 'endcap-video', path: context.videoPath };
      args = stillFfmpegArgs({
        sourceMp4: context.videoPath,
        graph: { vf: endcapVideoFilter(size) },
        at,
        out: tmpOut,
        postFilters: request.postFilters || [],
        preroll: stillPreroll(at, size.fps),
      });
    } else {
      plan = planCardRender({ ...context.planArgs, duration });
      assPath = cardStillAssPath({ out, base, at, config, index, total, kind: target.kind });
      fs.mkdirSync(path.dirname(assPath), { recursive: true });
      fs.writeFileSync(assPath, plan.ass);
      const graph = buildCardVideoGraph({ assPath, config, size, duration, thumbnail: context.thumbnail });
      args = cardStillFfmpegArgs({
        inputs: graph.inputs,
        filters: graph.filters,
        at,
        out: tmpOut,
        postFilters: request.postFilters || [],
      });
      source = {
        kind: `card-${plan.background.kind}`,
        path: plan.background.path,
        width: size.width,
        height: size.height,
        fps: size.fps,
        duration,
      };
    }
    log(`🖼️ ${base} t=${at.toFixed(3)}s を描きます`);

    await runFfmpegStill({ ffmpeg: tools.ffmpeg, args, signal: request.signal, timeoutMs, tmpOut });
    await fs.promises.rename(tmpOut, out);

    return {
      ok: true,
      out,
      assPath,
      at,
      requestedAt,
      index,
      total,
      clip: clip ? { base: clip.base, videoId: clip.videoId, file: clip.file } : null,
      card: { kind: target.kind, duration, thumbnail: context.thumbnail },
      size,
      source,
      zoom: null,
      avoidFace: null,
      enhance: null,
      elements: plan ? elementRects(plan.elements, size) : [],
      overlays: {},
      warnings: collectCardWarnings({ context, plan, at, requestedAt }),
      key: stillKey({ ass: plan?.ass || '', args, source }),
      ms: Date.now() - started,
    };
  } catch (err) {
    if (tmpOut) {
      fs.rmSync(tmpOut, { force: true });
    }
    if (isAbortError(err, request.signal)) {
      throw new StillAbortedError();
    }
    if (err.stderr !== undefined) {
      const message = firstLine(err.stderr) || firstLine(err.message);
      throw new Error(`静止画の書き出しに失敗しました: ${message}`);
    }
    throw err;
  }
}

async function buildCardStillAss(request, target) {
  const context = await loadCardContext(request, target);
  if (context.videoPath) {
    throw new Error(`endcaps.${target.kind}.video が指定されているため ASS はありません（指定動画をそのまま使います）。`);
  }
  const plan = planCardRender({ ...context.planArgs, duration: context.duration });
  return {
    ok: true,
    ass: plan.ass,
    index: context.index,
    total: context.total,
    clip: context.clip,
    size: context.size,
    elements: plan.elements,
    warnings: collectCardWarnings({ context, plan, at: null, requestedAt: null }),
  };
}

async function loadCardContext(request, target) {
  const { config } = loadConfigForStill(request.argv || [], target);
  const size = outputSize(config);
  const clips = collectClips(config);
  if (clips.length === 0) {
    throw new Error('クリップが選択されていません。');
  }

  if (target.kind === 'card') {
    if (!config.cards.enabled) {
      throw new Error('cards.enabled が false なので区切りカードはありません（--no-cards を外す）。');
    }
    const selected = selectStillClip({ clips, target });
    const clip = request.clipPatch
      ? { ...selected.clip, data: { ...selected.clip.data, ...request.clipPatch } }
      : selected.clip;
    // プレビューではサムネイルを取りに行かない。未取得なら warning を出して背景だけで描く。
    const thumbnail = await cacheThumbnail(clip.videoId, config, { allowDownload: false });
    const total = clips.length;
    return {
      config,
      size,
      clips,
      clip,
      index: selected.index,
      total,
      duration: Number(config.cards.duration) || 1.5,
      thumbnail,
      videoPath: null,
      planArgs: {
        kind: 'clip',
        clip,
        clips,
        index: selected.index,
        total,
        config,
        size,
        title: null,
        thumbnail,
      },
    };
  }

  const spec = config.endcaps[target.kind] || {};
  if (!spec.enabled) {
    throw new Error(`endcaps.${target.kind}.enabled が false です。`);
  }
  const index = target.kind === 'opening' ? 0 : clips.length - 1;
  const total = clips.length;
  return {
    config,
    size,
    clips,
    clip: null,
    index,
    total,
    duration: Number(spec.duration) || (target.kind === 'opening' ? 3 : 4),
    thumbnail: null,
    videoPath: endcapVideoPath(target.kind, config),
    planArgs: {
      kind: target.kind,
      clip: null,
      clips,
      index,
      total,
      config,
      size,
      title: config.titleOverride || null,
      thumbnail: null,
    },
  };
}

function cardStillBase(target, clip) {
  return target.kind === 'card' ? `card-${clip.base}` : target.kind;
}

function collectCardWarnings({ context, plan, at, requestedAt }) {
  const { config } = context;
  const warnings = [...(config.__meta?.stillWarnings || [])];
  if (context.clip && config.cards.thumbnail?.enabled && !context.thumbnail) {
    warnings.push({
      code: 'thumbnail_missing',
      message: `サムネイル未取得: cache/createVideo/thumbnails/${context.clip.videoId}.jpg（プレビューでは取りに行きません）。`,
    });
  }
  const requestedBackground = config.cards.background?.type;
  if (plan && requestedBackground && plan.background.kind !== requestedBackground) {
    warnings.push({
      code: 'card_background_fallback',
      message: `カード背景 ${requestedBackground} を読めないため ${plan.background.kind} で描いています。`,
    });
  }
  if (Number.isFinite(at) && Number.isFinite(requestedAt) && Math.abs(at - requestedAt) > 0.0005) {
    warnings.push({
      code: 'at_clamped',
      message: `指定時刻 ${requestedAt.toFixed(3)}s を ${at.toFixed(3)}s に丸めました。`,
    });
  }
  return warnings;
}

// カードは filter_complex が [v] を作るところまで本番と同じで、そこへ still 用の後段を足す。
export function cardStillFfmpegArgs({ inputs, filters, at, out, postFilters = [] }) {
  const post = ['format=yuv420p', ...postFilters.filter(Boolean)].join(',');
  return [
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-y',
    ...inputs,
    '-filter_complex', `${filters.join(';')};[v]${post}[out]`,
    '-map', '[out]',
    '-an',
    '-ss', Number(at).toFixed(3),
    '-frames:v', '1',
    '-update', '1',
    out,
  ];
}

// カードの ASS 置き場。クリップ側と同じく、中身を決める入力をすべてハッシュに入れて衝突を避ける。
function cardStillAssPath({ out, base, at, config, index, total, kind }) {
  const { __meta, ...effective } = config || {};
  const hash = crypto.createHash('sha1')
    .update(`${kind}\0${base}\0${Number(at).toFixed(3)}\0${index}/${total}\0`)
    .update(JSON.stringify(effective))
    .update('\0')
    .update(String(__meta?.cli?.title ?? ''))
    .digest('hex')
    .slice(0, 8);
  return path.join(path.dirname(out), '.ass', `${base}-t${Number(at).toFixed(3)}-${hash}.ass`);
}

function loadStillContext(request) {
  const target = parseStillTarget(request.still);
  if (target.kind !== 'clip') {
    throw new Error(`${target.kind} の静止画プレビューは未対応です。`);
  }
  const { config } = loadConfigForStill(request.argv || [], target);
  const size = outputSize(config);
  const clips = collectClips(config);
  const selected = selectStillClip({ clips, target });
  const clip = request.clipPatch
    ? { ...selected.clip, data: { ...selected.clip.data, ...request.clipPatch } }
    : selected.clip;
  return { config, size, target, index: selected.index, total: clips.length, clip };
}

function loadConfigForStill(argv, target) {
  try {
    return { config: loadConfig(argv), inferred: null };
  } catch (err) {
    if (!isMissingVideoIdError(err) || !target.base) {
      throw err;
    }
    const videoId = inferVideoId(target.base);
    if (!videoId) {
      throw err;
    }
    const config = loadConfig([...argv, '--videoId', videoId]);
    config.__meta.stillWarnings = [{
      code: 'videoid_inferred',
      message: `still の base から videoId=${videoId} を推定しました。`,
    }];
    return { config, inferred: videoId };
  }
}

function selectStillClip({ clips, target }) {
  if (target.position !== undefined) {
    const index = target.position - 1;
    if (!Number.isInteger(target.position) || target.position <= 0 || index >= clips.length) {
      throw new Error(`選択順 #${target.position} は範囲外です（1〜${clips.length}）。`);
    }
    return { index, clip: clips[index] };
  }
  const index = clips.findIndex((clip) => clip.base === target.base || clip.file === `${target.base}.json`);
  if (index < 0) {
    throw new Error(`選択にありません: ${target.base}。--files ${target.base} で単体選択できます（{i}/{n} は 1/1 になる）。`);
  }
  return { index, clip: clips[index] };
}

function normalizePlans(plans = {}, cli = {}) {
  const out = {
    zoom: cli.zoom === true ? true : false,
    avoid: cli['avoid-face'] === true ? true : false,
    enhance: true,
  };
  for (const key of ['zoom', 'avoid', 'enhance']) {
    if (plans?.[key] !== undefined) {
      out[key] = plans[key];
    }
  }
  return out;
}

function normalizeAssPlans(plans = {}) {
  const out = { zoom: false, avoid: false, enhance: false };
  for (const key of ['zoom', 'avoid', 'enhance']) {
    if (plans?.[key] !== undefined) {
      out[key] = plans[key];
    }
  }
  return out;
}

async function probeStillSource({ ffprobe, sourceMp4, kind, signal, timeoutMs }) {
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    sourceMp4,
  ], {
    signal,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
  });
  const json = JSON.parse(stdout);
  const stream = (json.streams || [])[0] || {};
  const [num, den] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
  return {
    path: sourceMp4,
    kind,
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    fps: den ? num / den : 0,
    duration: Number(json.format?.duration) || 0,
  };
}

async function runFfmpegStill({ ffmpeg, args, signal, timeoutMs, tmpOut }) {
  try {
    await execFileAsync(ffmpeg, args, {
      signal,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
  } catch (err) {
    fs.rmSync(tmpOut, { force: true });
    throw err;
  }
}

function resolveStillOut(out, { configPath, base, at }) {
  if (!out) {
    return stillOutPath({ configPath, base, at, root: projectRoot });
  }
  return path.isAbsolute(out) ? out : path.join(projectRoot, out);
}

// ASS の置き場。ffmpeg は subtitles= にパスしか渡せないので、ASS の中身を決める入力
// （設定・クリップ上書き・plan の有無・進行 {i}/{n}）をすべてハッシュに入れる。
// 同じクリップ・同じ時刻でも設定が違えば別ファイルになり、GUI の連続リクエストが互いの ASS を上書きしない。
function stillAssPath({ out, base, at, sourceMp4, config, clipPatch, plans, index, total }) {
  const { __meta, ...effective } = config || {};
  const hash = crypto.createHash('sha1')
    .update(`${base}\0${Number(at).toFixed(3)}\0${sourceMp4}\0${index}/${total}\0`)
    .update(JSON.stringify(effective))
    .update('\0')
    .update(JSON.stringify(clipPatch || null))
    .update('\0')
    .update(JSON.stringify(plans || null))
    .update('\0')
    .update(String(__meta?.cli?.title ?? ''))
    .digest('hex')
    .slice(0, 8);
  return path.join(path.dirname(out), '.ass', `${base}-t${Number(at).toFixed(3)}-${hash}.ass`);
}

function stripClipExt(value) {
  const ext = path.extname(value);
  return ext === '.json' || ext === '.mp4' ? value.slice(0, -ext.length) : value;
}

function inferVideoId(base) {
  const match = String(base).match(/^\d{4}-\d{2}-\d{2}-(.+)-\d{6}-\d{6}$/u);
  return match ? match[1] : null;
}

function isMissingVideoIdError(err) {
  return /select\.mode=videoId では --videoId または select\.videoId が必要です/u.test(err.message);
}

function clampAt(value, { duration, fps }) {
  const frame = 1 / (Number(fps) || 30);
  const max = Math.max(0, Number(duration) - frame);
  return Math.min(Math.max(0, value), max);
}

function positiveDuration(primary, fallback) {
  const value = Number(primary);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  const fallbackValue = Number(fallback);
  return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : 0.2;
}

function parsePositiveInt(value, label) {
  if (value === true || value === false || value === undefined || value === null) {
    throw new Error(`${label} は 1 以上の整数で指定してください: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} は 1 以上の整数で指定してください: ${value}`);
  }
  return parsed;
}

function resolveSheetOut(out, { configPath, name }) {
  if (out) {
    return path.isAbsolute(out) ? out : path.join(projectRoot, out);
  }
  return path.join(previewDirForConfig(configPath, projectRoot), name);
}

function previewDirForConfig(configPath, root) {
  const configBase = path.basename(configPath || 'config.json', '.json');
  return path.join(root, 'cache', 'createVideo', 'preview', configBase);
}

function sheetKey({ argv, items, columns, cellWidth, out }) {
  return crypto.createHash('sha1')
    .update(JSON.stringify({
      argv,
      columns,
      cellWidth,
      out,
      items: items.map((item) => ({ base: item.base, at: item.at, index: item.index })),
    }))
    .digest('hex')
    .slice(0, 16);
}

function unique(values) {
  return [...new Set(values)];
}

function even(value) {
  const rounded = Math.max(80, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function zoomPreviewRequested(config, clip) {
  return Boolean(config.effects?.zoom?.enabled || clip.data?.effects?.zoom);
}

function avoidPreviewRequested(config, clip) {
  const style = config.telops?.serif;
  return Boolean(
    style?.avoidFace?.enabled
      && style.box?.enabled
      && String(clip.data?.serif || '').trim()
  );
}

function isAbortError(err, signal) {
  return signal?.aborted || err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/u).find(Boolean) || '詳細なし';
}

function optString(opts, key) {
  const value = opts[key];
  if (value === undefined || value === true || value === false) {
    return undefined;
  }
  return String(Array.isArray(value) ? value.at(-1) : value);
}

function printWarnings(warnings) {
  for (const warning of warnings || []) {
    console.error(`⚠️  ${warning.code}: ${warning.message}`);
  }
}

function helpText() {
  return [
    '使い方:',
    '  npm run still -- --still <base|#N|card:<base>|opening|ending> [--at 2.05|50%] [--out out.png]',
    '',
    'オプション:',
    '  --still <target>      クリップ base / base.json / base.mp4 / #N /',
    '                        card:<base> / card:#N（区切りカード）/ opening / ending',
    '  --at <time>           秒または N%。省略時はクリップ中央付近',
    '  --out <path>          PNG の出力先',
    '  --json                結果を 1 行 JSON で出力',
    '  --print-ass           PNG を作らず ASS 本文だけ出力',
    '  --sheet [columns]     選択クリップ全件を一覧 PNG にする',
    '  --frames <n>          1 クリップから n 枚を抜いて一覧 PNG にする',
    '  --zoom                preview でズーム計画を反映',
    '  --avoid-face          preview で顔回避を反映',
    '  --help                このヘルプを表示',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(helpText());
    return;
  }

  const json = Boolean(opts.json);
  const printAss = Boolean(opts['print-ass']);
  if (json || printAss) {
    console.log = (...args) => console.error(...args);
  }

  const sheet = opts.sheet !== undefined;
  const frames = opts.frames !== undefined;
  if (sheet && frames) {
    throw new Error('--sheet と --frames は同時に指定できません。');
  }
  if ((sheet || frames) && printAss) {
    throw new Error('--print-ass は単体 still だけで使えます。');
  }

  const still = optString(opts, 'still');
  if (sheet || frames) {
    const framesValue = optString(opts, 'frames');
    if (frames && !framesValue) {
      throw new Error('--frames <n> を指定してください。');
    }
    if (frames && !still) {
      throw new Error('--frames には --still <base|#N> が必要です。');
    }
    const result = await renderSheet({
      argv,
      still,
      frames: frames ? framesValue : undefined,
      columns: optString(opts, 'sheet'),
      out: optString(opts, 'out'),
      log: (line) => console.error(line),
    });
    if (json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      if (result.failed.length > 0) {
        console.error(`⚠️  missing: ${result.failed.join(', ')}`);
      }
      process.stdout.write(`${path.resolve(result.out)}\n`);
    }
    return;
  }

  if (!still) {
    throw new Error('--still を指定してください。');
  }

  if (printAss) {
    const result = await buildStillAss({ argv, still });
    process.stdout.write(result.ass);
    return;
  }

  const result = await renderStill({
    argv,
    still,
    at: optString(opts, 'at'),
    out: optString(opts, 'out'),
    log: (line) => console.error(line),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    printWarnings(result.warnings);
    process.stdout.write(`${path.resolve(result.out)}\n`);
  }
}

if (process.argv[1] === __filename) {
  main().catch((err) => {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: err.message,
        warnings: err.warnings || [],
      })}\n`);
    } else {
      console.error('💥 静止画プレビュー中にエラーが発生しました:');
      console.error(err.message);
      printWarnings(err.warnings);
    }
    process.exit(1);
  });
}
