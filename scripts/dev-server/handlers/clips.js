import fs from 'node:fs';

import { DEFAULTS, deepMerge } from '../../create-video/config.js';
import { clipSourcePathFor } from '../../create-video/clip.js';
import { collectClips, readAllClips } from '../../create-video/select.js';
import { assertNoForbiddenKeys } from '../lib/guards.js';
import { stripInternal } from '../lib/patch.js';

const SELECT_MODES = new Set(['videoId', 'category', 'files']);

export function createClipRoutes() {
  return [
    { method: 'POST', pattern: /^\/clips$/u, handler: async (req) => listClips(req.body) },
  ];
}

// draft の select をそのまま collectClips に通し、ビルド順そのものを返す。
// 対象 0 件はクリップ画面では通常状態なので warning、files の不明エントリだけ error にする。
async function listClips(body) {
  let draft;
  try {
    draft = parseDraft(body);
  } catch (error) {
    return { status: 400, json: { error: error instanceof Error ? error.message : String(error) } };
  }

  const config = deepMerge(structuredClone(DEFAULTS), stripInternal(draft));
  const all = readAllClips();
  const catalog = buildCatalog(all);
  const mode = config.select?.mode;
  if (!SELECT_MODES.has(mode)) {
    return { status: 200, json: { clips: [], error: `select.mode が不正です: ${mode}`, catalog } };
  }

  let clips = [];
  let warning;
  let error;
  try {
    clips = collectClips(config).map(clipInfo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/select\.files の指定が見つかりません/u.test(message)) {
      error = message;
    } else {
      warning = message;
    }
  }

  return {
    status: 200,
    json: {
      clips,
      ...(warning ? { warning } : {}),
      ...(error ? { error } : {}),
      catalog,
    },
  };
}

function parseDraft(body) {
  if (!isPlainObject(body) || !isPlainObject(body.draft)) {
    throw new Error('draft must be an object');
  }
  assertNoForbiddenKeys(body.draft, 'draft');
  return body.draft;
}

export function clipInfo(clip) {
  const meta = clip.meta || {};
  const data = clip.data || {};
  return {
    base: clip.base,
    videoId: clip.videoId,
    serif: typeof data.serif === 'string' ? data.serif : '',
    ruby: typeof data.ruby === 'string' ? data.ruby : '',
    memo: typeof data.memo === 'string' ? data.memo : '',
    categories: Array.isArray(clip.categories) ? clip.categories : [],
    startTime: clip.startTime,
    endTime: clip.endTime,
    duration: clip.duration,
    uploadDate: clip.uploadDate ?? null,
    title: typeof meta.title === 'string' ? meta.title : '',
    // existing = public/videos（256x144）、cache = cache/createVideo/<videoId>（1080p）。バッジ表示用。
    source: {
      existing: fs.existsSync(clipSourcePathFor(clip, { source: 'existing' })),
      cache: fs.existsSync(clipSourcePathFor(clip, { source: 'cache' })),
    },
  };
}

function buildCatalog(all) {
  const categoryCounts = new Map();
  const videoIdMap = new Map();
  for (const clip of all) {
    for (const category of clip.categories || []) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
    const entry = videoIdMap.get(clip.videoId) || {
      videoId: clip.videoId,
      title: clip.meta?.title || '',
      uploadDate: clip.uploadDate ?? null,
      count: 0,
    };
    entry.count += 1;
    videoIdMap.set(clip.videoId, entry);
  }

  return {
    clips: all.map(clipInfo),
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    videoIds: [...videoIdMap.values()].sort((a, b) => String(a.uploadDate).localeCompare(String(b.uploadDate))),
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
