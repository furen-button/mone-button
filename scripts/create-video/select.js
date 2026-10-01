import fs from 'fs';
import path from 'path';
import { dataDir } from './assets.js';

// public/data の全クリップをファイル名順に読む。選択前の母集団で、エディタのカタログ表示にも使う。
export function readAllClips() {
  if (!fs.existsSync(dataDir)) {
    throw new Error(`データディレクトリがありません: ${dataDir}`);
  }

  return fs.readdirSync(dataDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => readClip(file));
}

export function collectClips(config) {
  const all = readAllClips();

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

  selected = applyExclusions(selected, config.select.exclude, all);
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

/**
 * select.exclude で指定されたクリップを落とす。
 * 指定はファイル名（拡張子あり/なし）でも videoId でもよく、videoId ならその配信の全クリップを除外する。
 * 区間が重なる sub-clip やコラボ配信を、public/data を触らずにビルドから外すために使う。
 */
function applyExclusions(clips, exclude, all) {
  if (!Array.isArray(exclude) || exclude.length === 0) {
    return clips;
  }
  const keys = new Set(exclude.map((entry) => {
    const name = path.basename(String(entry));
    return name.endsWith('.json') ? path.basename(name, '.json') : name;
  }));
  const kept = clips.filter((clip) => !keys.has(clip.base) && !keys.has(clip.videoId));

  // 除外リストは複数のまとめ動画で使い回すため、選択に含まれない指定があるのは正常。
  // public/data のどこにも存在しない指定＝綴り間違いのときだけ警告する。
  const known = new Set();
  for (const clip of all) {
    known.add(clip.base);
    known.add(clip.videoId);
  }
  const unknown = [...keys].filter((key) => !known.has(key));
  if (unknown.length > 0) {
    console.warn(`⚠️  select.exclude の指定が public/data に存在しません: ${unknown.join(', ')}`);
  }
  if (kept.length < clips.length) {
    console.log(`🚫 除外 ${clips.length - kept.length} 件`);
  }
  return kept;
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
