import fs from 'fs';
import path from 'path';
import { dataDir } from './assets.js';

export function collectClips(config) {
  if (!fs.existsSync(dataDir)) {
    throw new Error(`データディレクトリがありません: ${dataDir}`);
  }

  const all = fs.readdirSync(dataDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => readClip(file));

  let selected;
  switch (config.select.mode) {
    case 'videoId':
      selected = all.filter((clip) => clip.videoId === config.select.videoId || clip.file.includes(`-${config.select.videoId}-`));
      break;
    case 'category':
      selected = all.filter((clip) => intersects(clip.categories, config.select.categories));
      break;
    case 'files':
      selected = collectExplicitFiles(all, config.select.files);
      break;
    default:
      throw new Error(`未対応の select.mode です: ${config.select.mode}`);
  }

  selected = orderClips(selected, config.select.order, config.select.mode);
  if (config.select.limit !== null && config.select.limit !== undefined) {
    selected = selected.slice(0, Number(config.select.limit));
  }

  if (selected.length === 0) {
    throw new Error('対象クリップが public/data に見つかりません。');
  }
  return selected;
}

function readClip(file) {
  const filePath = path.join(dataDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const meta = data.videoFile?.metadata || {};
  return {
    file,
    filePath,
    base: path.basename(file, '.json'),
    data,
    videoId: data.videoId || meta.videoId,
    categories: Array.isArray(data.categories) ? data.categories : [],
    startTime: Number(data.trimming?.startTime ?? 0),
    endTime: Number(data.trimming?.endTime ?? 0),
    duration: Number(data.trimming?.duration ?? 0),
    meta,
    uploadDate: meta.uploadDate || file.slice(0, 10).replaceAll('-', ''),
  };
}

function intersects(left, right) {
  const set = new Set(left);
  return right.some((item) => set.has(item));
}

function collectExplicitFiles(all, files) {
  const byBase = new Map();
  for (const clip of all) {
    byBase.set(clip.file, clip);
    byBase.set(clip.base, clip);
  }
  return files.map((entry) => {
    const ext = path.extname(entry);
    const key = ext ? path.basename(entry, ext) : path.basename(entry);
    const fileKey = entry.endsWith('.json') ? path.basename(entry) : `${key}.json`;
    const clip = byBase.get(path.basename(entry)) || byBase.get(fileKey) || byBase.get(key);
    if (!clip) throw new Error(`select.files の指定が見つかりません: ${entry}`);
    return clip;
  });
}

function orderClips(clips, order, mode) {
  const out = [...clips];
  if (order === 'as-listed') return out;
  if (order === 'shuffle') return shuffle(out);

  out.sort((a, b) => {
    if (order === 'stream') {
      return compare(a.uploadDate, b.uploadDate) || compare(a.videoId, b.videoId) || compare(a.startTime, b.startTime) || compare(a.file, b.file);
    }
    return compare(a.uploadDate, b.uploadDate) || compare(a.startTime, b.startTime) || compare(a.file, b.file);
  });

  if (order === 'date-desc') out.reverse();
  if (mode === 'videoId' && order === 'date') {
    out.sort((a, b) => compare(a.startTime, b.startTime) || compare(a.file, b.file));
  }
  return out;
}

function compare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
