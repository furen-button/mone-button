import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { videoSidecar } from '../dev-server/lib/thumbnail-paths.js';
import { readRecord, recordErrors } from './record.js';

export function tagLength(tags) {
  return Math.max(0, tags.length - 1) + tags.reduce((sum, tag) => sum + [...tag].length + (/\s/u.test(tag) ? 2 : 0), 0);
}

// 検査自体は値だけから行う。ファイルの読み取りと API 呼び出しは分離する。
export function buildPlan({ videoPath, sha256, meta, description, thumbnail = null, comments = [],
  manifest = null, qc = null, qcTrusted = false, record = null, options = {} }) {
  const errors = [];
  const warnings = [];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    errors.push('meta.json の形式が不正です。');
  }
  const upload = meta?.upload || {};
  const title = options.title ?? upload.title ?? '';
  if (typeof title !== 'string' || [...title].length < 1 || [...title].length > 100 || /[<>]/u.test(title)) {
    errors.push('タイトルは < > を含まない 1〜100 文字にしてください。');
  }
  if (typeof description !== 'string' || Buffer.byteLength(description) > 5000 || /[<>]/u.test(description)) {
    errors.push('概要欄は < > を含まない 5,000 バイト以内にしてください。');
  }
  const tags = meta?.tags ?? [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string') || tagLength(tags) > 500) {
    errors.push('タグはカンマと空白入りタグの引用符を含めて合計 500 文字以内にしてください。');
  }
  if (upload.categoryId !== undefined && (typeof upload.categoryId !== 'string' || !/^\d+$/u.test(upload.categoryId))) {
    errors.push('upload.categoryId は数字の文字列にしてください。');
  }
  if (upload.containsSyntheticMedia !== undefined && typeof upload.containsSyntheticMedia !== 'boolean') {
    errors.push('upload.containsSyntheticMedia は真偽値にしてください。');
  }
  if (thumbnail && (thumbnail.bytes > 50 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(thumbnail.mimeType))) {
    errors.push('サムネイルは 50MB 以内の jpeg / png にしてください。');
  }
  if (!manifest) {
    warnings.push('render.json が無いため SHA-256 を照合できません。');
  } else if (manifest.version !== 2 || manifest.videoSha256 !== sha256) {
    errors.push('render.json の SHA-256 が mp4 と一致しません（version 2 が必要です）。');
  }
  let qcErrorAllowed = false;
  if (!qc || !qcTrusted) {
    warnings.push('対応する QC が無いため QC 結果を確認できません。');
  } else if (!Array.isArray(qc.results) || !qc.summary || !Number.isInteger(qc.summary.error)) {
    errors.push('qc.json の形式が不正です。');
  } else if (qc.summary.error > 0 || qc.results.some((result) => result.level === 'error')) {
    // 目視で確かめた誤検出だけを通す。形式不正は上書きしない。
    if (options.allowQcError) {
      qcErrorAllowed = true;
      warnings.push('qc.json の error を --allow-qc-error で無視します。');
    } else {
      errors.push('qc.json に error があります。目視で問題が無ければ --allow-qc-error を指定してください。');
    }
  }
  errors.push(...recordErrors(record, sha256, options));
  return {
    videoPath, sha256, thumbnail, comments, record, errors, warnings, qcErrorAllowed,
    requestBody: {
      snippet: { title, description, tags, categoryId: upload.categoryId ?? '24', defaultLanguage: 'ja', defaultAudioLanguage: 'ja' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: upload.containsSyntheticMedia ?? false },
    },
  };
}

function thumbnailInfo(file) {
  const handle = fs.openSync(file, 'r');
  const header = Buffer.alloc(8);
  try {
    fs.readSync(handle, header, 0, 8, 0);
  } finally {
    fs.closeSync(handle);
  }
  const mimeType = header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
    : header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : null;
  return { path: file, bytes: fs.statSync(file).size, mimeType };
}

export async function loadPlan(videoPath, { projectRoot, outputDir = path.join(projectRoot, 'output'), ...options }) {
  videoPath = path.resolve(projectRoot, videoPath);
  if (!/\.mp4$/iu.test(videoPath) || !fs.statSync(videoPath).isFile()) {
    throw new Error('通常ファイルの mp4 を指定してください。');
  }
  const context = { projectRoot, outputDir };
  const sidecar = (suffix) => videoSidecar(context, videoPath, suffix);
  const required = (suffix) => {
    const file = sidecar(suffix);
    if (!file) {
      throw new Error(`${suffix} がありません。`);
    }
    return fs.readFileSync(file, 'utf8');
  };
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(videoPath)) {
    hash.update(chunk);
  }
  const sha256 = hash.digest('hex');
  const manifestPath = sidecar('render.json');
  const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  // QC は検証した manifest の隣のものだけを信じる。
  const qcPath = manifestPath?.replace(/\.render\.json$/u, '.qc.json');
  const qc = qcPath && fs.existsSync(qcPath) ? JSON.parse(fs.readFileSync(qcPath, 'utf8')) : null;
  const thumbnailPath = options.noThumbnail ? null : sidecar(['thumbnail.jpg', 'thumbnail.png']);
  const comments = [];
  if (!options.noComment) {
    const first = sidecar('comment-1.txt');
    if (first) {
      const base = path.basename(videoPath, path.extname(videoPath));
      const dir = path.dirname(first);
      const numbers = fs.readdirSync(dir).flatMap((name) => {
        const prefix = `${base}.comment-`;
        return name.startsWith(prefix) && /^\d+\.txt$/u.test(name.slice(prefix.length)) ? [Number(name.slice(prefix.length, -4))] : [];
      }).sort((a, b) => a - b);
      for (const [i, n] of numbers.entries()) {
        if (n !== i + 1) {
          throw new Error('分割コメントの番号が連続していません。');
        }
        comments.push(fs.readFileSync(path.join(dir, `${base}.comment-${n}.txt`), 'utf8'));
      }
    } else {
      const single = sidecar('comment.txt');
      if (single) {
        comments.push(fs.readFileSync(single, 'utf8'));
      }
    }
  }
  return buildPlan({ videoPath, sha256, meta: JSON.parse(required('meta.json')), description: required('youtube.txt'),
    thumbnail: thumbnailPath ? thumbnailInfo(thumbnailPath) : null, comments, manifest, qc,
    qcTrusted: manifest?.version === 2 && manifest.videoSha256 === sha256,
    record: readRecord(videoPath), options });
}
