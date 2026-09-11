import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { dataDir } from '../../create-video/assets.js';
import { renderSheet, renderStill, StillAbortedError } from '../../create-video/preview.js';
import { assertNoForbiddenKeys, clipBase as clipBaseGuard, presetFileName } from '../lib/guards.js';
import { stripInternal } from '../lib/patch.js';
import { writeScratch } from '../lib/scratch.js';

// ffmpeg を同時に走らせすぎない。GUI は前のリクエストを abort してから次を投げるので通常は 1 本。
const MAX_CONCURRENT = 2;
const MAX_TITLE = 200;
const MAX_SERIF = 500;
let active = 0;

export function createStillRoutes(context) {
  return [
    { method: 'POST', pattern: /^\/still$/u, handler: async (req) => still(context, req) },
    { method: 'POST', pattern: /^\/sheet$/u, handler: async (req) => sheet(context, req) },
  ];
}

// 未保存の draft を scratch に書き、その --config で preview.js の renderStill を in-process で呼ぶ。
// 応答は PNG バイト列 + X-Still-Meta（URL エンコード JSON）。同じ入力のハッシュが既にあれば再描画しない。
async function still(context, req) {
  let payload;
  try {
    payload = parseStillPayload(body(req));
  } catch (error) {
    return jsonError(400, error);
  }

  const key = sha1(JSON.stringify({
    draft: stripInternal(payload.draft),
    clipBase: payload.clipBase,
    at: payload.at ?? null,
    title: payload.title ?? null,
    serifOverride: payload.serifOverride ?? null,
    zoom: payload.zoom,
  }));
  const outDir = path.join(context.cacheDir, 'stills');
  const out = path.join(outDir, `${key}.png`);
  const metaPath = path.join(outDir, `${key}.json`);
  const cachedMeta = readJson(metaPath);
  if (cachedMeta && fs.existsSync(out)) {
    return pngResponse(out, { ...cachedMeta, cached: true, key }, 'X-Still-Meta');
  }

  if (active >= MAX_CONCURRENT) {
    return { status: 429, json: { error: 'too many concurrent still renders' } };
  }

  const scratch = writeScratch({ cacheDir: context.cacheDir, name: payload.name, draft: payload.draft });
  const argv = ['--config', scratch, ...(payload.title ? ['--title', payload.title] : [])];
  active += 1;
  try {
    const result = await renderStill({
      argv,
      still: payload.clipBase,
      at: payload.at,
      clipPatch: payload.serifOverride !== undefined ? { serif: payload.serifOverride } : undefined,
      plans: { zoom: payload.zoom },
      out,
      signal: req.signal,
      log: () => {},
    });
    const meta = pickMeta(result);
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    return pngResponse(out, { ...meta, cached: false, key }, 'X-Still-Meta');
  } catch (error) {
    if (error instanceof StillAbortedError || req.signal?.aborted) {
      return { status: 499, json: { error: 'aborted' } };
    }
    return {
      status: error?.code === 'source_missing' ? 422 : 500,
      json: { error: error instanceof Error ? error.message : String(error), code: error?.code, warnings: error?.warnings || [] },
    };
  } finally {
    active -= 1;
  }
}

async function sheet(context, req) {
  let payload;
  try {
    payload = parseSheetPayload(body(req));
  } catch (error) {
    return jsonError(400, error);
  }

  const key = sha1(JSON.stringify({ draft: stripInternal(payload.draft), columns: payload.columns ?? null, sheet: true }));
  const outDir = path.join(context.cacheDir, 'sheets');
  const out = path.join(outDir, `${key}.png`);
  const metaPath = path.join(outDir, `${key}.json`);
  const cachedMeta = readJson(metaPath);
  if (cachedMeta && fs.existsSync(out)) {
    return pngResponse(out, { ...cachedMeta, cached: true, key }, 'X-Sheet-Meta');
  }

  const scratch = writeScratch({ cacheDir: context.cacheDir, name: payload.name, draft: payload.draft });
  try {
    const result = await renderSheet({
      argv: ['--config', scratch],
      columns: payload.columns,
      out,
      signal: req.signal,
      log: () => {},
    });
    const meta = { columns: result.columns, rows: result.rows, cellWidth: result.cellWidth, cells: result.cells, failed: result.failed, ms: result.ms };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    return pngResponse(out, { ...meta, cached: false, key }, 'X-Sheet-Meta');
  } catch (error) {
    if (error instanceof StillAbortedError || req.signal?.aborted) {
      return { status: 499, json: { error: 'aborted' } };
    }
    return { status: 500, json: { error: error instanceof Error ? error.message : String(error) } };
  }
}

function parseStillPayload(raw) {
  const base = parseCommon(raw);
  const clipBase = clipBaseGuard(raw.clipBase);
  if (!clipBase || !fs.existsSync(path.join(dataDir, `${clipBase}.json`))) {
    throw new Error('clipBase is not a known clip');
  }
  let at;
  if (raw.at !== undefined && raw.at !== null) {
    at = Number(raw.at);
    if (!Number.isFinite(at) || at < 0) {
      throw new Error('at must be a non-negative number');
    }
  }
  if (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > MAX_TITLE)) {
    throw new Error(`title must be a string of ${MAX_TITLE} chars or less`);
  }
  if (raw.serifOverride !== undefined && (typeof raw.serifOverride !== 'string' || raw.serifOverride.length > MAX_SERIF)) {
    throw new Error(`serifOverride must be a string of ${MAX_SERIF} chars or less`);
  }
  return {
    ...base,
    clipBase,
    at,
    title: raw.title || undefined,
    serifOverride: raw.serifOverride,
    zoom: raw.zoom === true,
  };
}

function parseSheetPayload(raw) {
  const base = parseCommon(raw);
  let columns;
  if (raw.columns !== undefined && raw.columns !== null) {
    columns = Number(raw.columns);
    if (!Number.isInteger(columns) || columns < 1 || columns > 12) {
      throw new Error('columns must be an integer between 1 and 12');
    }
  }
  return { ...base, columns };
}

function parseCommon(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('body must be an object');
  }
  const name = presetFileName(raw.name);
  if (!name) {
    throw new Error('invalid preset name');
  }
  if (!isPlainObject(raw.draft)) {
    throw new Error('draft must be an object');
  }
  assertNoForbiddenKeys(raw.draft, 'draft');
  return { name, draft: raw.draft };
}

function pickMeta(result) {
  return {
    at: result.at,
    requestedAt: result.requestedAt,
    index: result.index,
    total: result.total,
    clip: result.clip,
    size: result.size,
    source: result.source,
    zoom: result.zoom,
    avoidFace: result.avoidFace,
    enhance: result.enhance,
    elements: result.elements,
    overlays: result.overlays,
    warnings: result.warnings,
    ms: result.ms,
    out: result.out,
  };
}

function pngResponse(file, meta, headerName) {
  const size = fs.statSync(file).size;
  return {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      // warnings に日本語が入り HTTP ヘッダは Latin-1 なので URL エンコードで 1 本にまとめる。
      [headerName]: encodeURIComponent(JSON.stringify(meta)),
    },
    stream: fs.createReadStream(file),
    length: size,
  };
}

function body(req) {
  return req.body;
}

function jsonError(status, error) {
  return { status, json: { error: error instanceof Error ? error.message : String(error) } };
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
