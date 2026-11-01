import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { CAMERA_ASPECTS, cameraRectAt, normalizeCamera } from '../../create-video/camera.js';
import { cameraFilters, exportEnhance } from '../../create-video/camera-render.js';
import { ffmpegLibplaceboStatus, probeVideoStream, resolveFfmpeg } from '../../create-video/ffmpeg.js';
import { UPLOAD_EXTENSIONS, cropDirs, newUploadId, resolveCropRef } from '../lib/crop-source.js';
import { clipBase as clipBaseGuard } from '../lib/guards.js';
import { resolveOutputFile } from './files.js';

const execFileAsync = promisify(execFile);

// 切り出しツール（crop.html）の API。元動画のアップロード・クリップの照合・1 枚の確認・書き出しジョブ。
// クリップへの保存は public/data を書く処理を 1 か所に保つため /__data/save（vite-plugin-data-editor）が受ける。

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
const KEEP_UPLOADS = 10;
export const EXPORT_SIZES = {
  '9:16': ['1080x1920', '720x1280'],
  '16:9': ['1920x1080', '1280x720'],
  '1:1': ['1080x1080'],
};
export const SCALERS = ['anime4k', 'lanczos'];

let tools = null;

// ffmpeg の解決は 1 プロセスで 1 回だけ（libass の確認で ffmpeg を起動するため）。
function resolveTools() {
  tools ??= resolveFfmpeg();
  return tools;
}

function probeSource(file) {
  return probeVideoStream(resolveTools().ffprobe, file);
}

// deps.probe はテストから ffprobe を差し替えるための注入口。
export function createCropRoutes(context, manager, deps = {}) {
  const probe = deps.probe || probeSource;
  return [
    { method: 'POST', pattern: /^\/crop\/upload$/u, rawBody: true, handler: async (req) => upload(context, req, probe) },
    { method: 'GET', pattern: /^\/crop\/clip\/(?<base>[\w-]+)$/u, handler: async (req, params) => clipResponse(context, params.base, probe) },
    { method: 'POST', pattern: /^\/crop\/still$/u, handler: async (req) => still(context, req, probe) },
    { method: 'POST', pattern: /^\/crop\/export$/u, handler: async (req) => startExport(context, manager, req.body) },
  ];
}

// 本文をそのまま cache/crop/uploads/<id>.<ext> に書く。途中で切れた・大きすぎるときは残骸を消す。
async function upload(context, req, probe) {
  // 元の名前は表示と書き出し名の元にだけ使い（保存名は <id>.<ext>）、パスとして解釈しない。
  const name = req.query.get('name') || '';
  const ext = path.extname(name).toLowerCase();
  if (name.length > 255 || path.basename(name) !== name || name.includes('\0') || !UPLOAD_EXTENSIONS.includes(ext)) {
    return { status: 400, json: { error: `動画のファイル名（${UPLOAD_EXTENSIONS.join(' / ')}）を指定してください。` } };
  }
  if (!req.stream) {
    return { status: 400, json: { error: 'body stream is required' } };
  }
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) {
    return { status: 413, json: { error: 'upload too large' } };
  }

  const dirs = cropDirs(context.projectRoot);
  fs.mkdirSync(dirs.uploads, { recursive: true });
  const id = newUploadId();
  const file = path.join(dirs.uploads, `${id}${ext}`);
  const partial = `${file}.part`;
  let size = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        callback(Object.assign(new Error('upload too large'), { status: 413 }));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(req.stream, counter, fs.createWriteStream(partial), { signal: req.signal });
  } catch (error) {
    fs.rmSync(partial, { force: true });
    return { status: error?.status === 413 ? 413 : 400, json: { error: error instanceof Error ? error.message : String(error) } };
  }
  fs.renameSync(partial, file);

  let info;
  try {
    info = probe(file);
  } catch {
    info = null;
  }
  if (!(info?.width > 0 && info?.height > 0)) {
    fs.rmSync(file, { force: true });
    return { status: 422, json: { error: '動画として読めませんでした。' } };
  }
  fs.writeFileSync(path.join(dirs.uploads, `${id}.json`), JSON.stringify({ name, size, uploadedAt: Date.now() }));
  pruneUploads(dirs.uploads, KEEP_UPLOADS);

  const base = path.basename(name, ext);
  const clip = clipBaseGuard(base) ? clipInfo(context, base, probe) : null;
  return { status: 200, json: { source: `upload:${id}`, name, size, probe: info, clip } };
}

// アップロードは新しい順に keep 本だけ残す（4GB まで受けるので溜めない）。
export function pruneUploads(dir, keep) {
  const uploads = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ id: name.slice(0, -'.json'.length), mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { id } of uploads.slice(keep)) {
    for (const name of fs.readdirSync(dir).filter((entry) => entry.startsWith(`${id}.`))) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

async function clipResponse(context, base, probe) {
  const clip = clipInfo(context, base, probe);
  if (!clip) {
    return { status: 404, json: { error: 'clip not found' } };
  }
  return { status: 200, json: { clip } };
}

// public/data のクリップと、サーバ上にあるその元動画（高画質キャッシュ・サイト用）。
// ドロップしたファイルとサイズが同じならアップロードを省けるよう size も返す。
export function clipInfo(context, base, probe) {
  const dirs = cropDirs(context.projectRoot);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dirs.data, `${base}.json`), 'utf8'));
  } catch {
    return null;
  }
  const sources = [];
  for (const ref of [`cache:${base}`, `public:${base}`]) {
    const target = resolveOutputFile(context, 'crop-source', ref);
    if (!target) {
      continue;
    }
    let info = null;
    try {
      info = probe(target.path);
    } catch {
      info = null;
    }
    sources.push({ source: ref, size: target.size, probe: info });
  }
  return {
    base,
    videoId: typeof data.videoId === 'string' ? data.videoId : '',
    serif: typeof data.serif === 'string' ? data.serif : '',
    camera: data.effects?.camera && typeof data.effects.camera === 'object' ? data.effects.camera : {},
    sources,
  };
}

// 本文 { source, keyframes, aspect, size, scaler, at? } を検証する。at は still だけが要る。
export function parseCropPayload(body, { requireAt = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('body must be an object');
  }
  if (!CAMERA_ASPECTS.includes(body.aspect)) {
    throw badRequest('aspect は 9:16 / 16:9 / 1:1 で指定してください。');
  }
  if (!EXPORT_SIZES[body.aspect].includes(body.size)) {
    throw badRequest(`size は ${EXPORT_SIZES[body.aspect].join(' / ')} で指定してください。`);
  }
  if (!SCALERS.includes(body.scaler)) {
    throw badRequest('scaler は anime4k / lanczos で指定してください。');
  }
  if (typeof body.source !== 'string') {
    throw badRequest('source を指定してください。');
  }
  const normalized = normalizeCamera(body.keyframes);
  if (normalized.error) {
    throw badRequest(normalized.error);
  }
  if (requireAt && !(Number.isFinite(body.at) && body.at >= 0)) {
    throw badRequest('at は 0 以上の秒で指定してください。');
  }
  const [width, height] = body.size.split('x').map(Number);
  return {
    source: body.source,
    aspect: body.aspect,
    size: body.size,
    width,
    height,
    scaler: body.scaler,
    keyframes: normalized.keyframes,
    at: requireAt ? body.at : null,
  };
}

// 1 枚だけ本番と同じ拡大で描く。-ss を -i の前に置いて速くシークし、
// 枠は cameraRectAt で求めた静的な値を渡す（時刻の式は使わない）。
async function still(context, req, probe) {
  let payload;
  try {
    payload = parseCropPayload(req.body, { requireAt: true });
  } catch (error) {
    return jsonError(error);
  }
  const target = resolveOutputFile(context, 'crop-source', payload.source);
  if (!target) {
    return { status: 404, json: { error: 'source not found' } };
  }
  const dirs = cropDirs(context.projectRoot);
  const key = crypto.createHash('sha1')
    .update(JSON.stringify({ file: [target.path, target.size, target.mtimeMs], ...payload }))
    .digest('hex');
  const out = path.join(dirs.stills, `${key}.png`);
  const metaPath = path.join(dirs.stills, `${key}.json`);
  if (fs.existsSync(out) && fs.existsSync(metaPath)) {
    return pngResponse(out, { ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), cached: true });
  }

  const started = Date.now();
  try {
    const info = probe(target.path);
    const ffmpeg = resolveTools();
    const status = ffmpegLibplaceboStatus(ffmpeg.ffmpeg);
    const from = { width: info.width, height: info.height };
    const plan = { applied: true, aspect: payload.aspect, keyframes: payload.keyframes, from, backend: status.ok ? 'libplacebo' : 'sendcmd' };
    const rect = cameraRectAt(payload.keyframes, payload.at, from, payload.aspect);
    const enhance = payload.scaler === 'anime4k' ? await exportEnhance({ tools: ffmpeg, sourceMp4: target.path, probe: info }) : null;
    const vf = cameraFilters(plan, { width: payload.width, height: payload.height }, { enhance, rect });
    fs.mkdirSync(dirs.stills, { recursive: true });
    await execFileAsync(ffmpeg.ffmpeg, [
      '-hide_banner', '-v', 'error', '-y',
      '-ss', String(payload.at), '-i', target.path,
      '-frames:v', '1', '-vf', vf, out,
    ], { signal: req.signal });
    const meta = { rect, backend: plan.backend, enhance: Boolean(enhance?.applied), ms: Date.now() - started };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    return pngResponse(out, { ...meta, cached: false });
  } catch (error) {
    fs.rmSync(out, { force: true });
    if (req.signal?.aborted) {
      return { status: 499, json: { error: 'aborted' } };
    }
    return { status: 500, json: { error: error instanceof Error ? error.message : String(error) } };
  }
}

// 書き出しは createVideo のビルドと同じ JobManager で走らせ、ログ・キャンセルは /build/<id>/* を使う。
async function startExport(context, manager, body) {
  let payload;
  try {
    payload = parseCropPayload(body);
  } catch (error) {
    return jsonError(error);
  }
  const target = resolveOutputFile(context, 'crop-source', payload.source);
  const ref = resolveCropRef(context.projectRoot, payload.source);
  if (!target || !ref) {
    return { status: 404, json: { error: 'source not found' } };
  }
  const dirs = cropDirs(context.projectRoot);
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15);
  const outName = `${safeStem(ref.label)}-${payload.aspect.replace(':', 'x')}-${stamp}`;
  fs.mkdirSync(dirs.jobs, { recursive: true });
  const cameraPath = path.join(dirs.jobs, `${outName}.json`);
  fs.writeFileSync(cameraPath, JSON.stringify(payload.keyframes, null, 2));
  const argv = [
    '--input', target.path,
    '--camera', cameraPath,
    '--aspect', payload.aspect,
    '--size', payload.size,
    '--scaler', payload.scaler,
    '--out', path.join(dirs.output, `${outName}.mp4`),
  ];
  try {
    const job = manager.start({ kind: 'crop', name: outName, argv, logName: `crop-${outName}` });
    return { status: 200, json: { job, outName } };
  } catch (error) {
    if (error?.status === 409) {
      return { status: 409, json: { error: 'busy', jobId: error.jobId } };
    }
    return jsonError(error);
  }
}

// 書き出し名に使えない文字を _ にする（outputBaseName と同じ文字種）。
export function safeStem(label) {
  const stem = String(label || 'video').replace(/[^\p{L}\p{N}_.\- ]/gu, '_').replace(/^\.+/u, '').slice(0, 80).trim();
  return stem || 'video';
}

function pngResponse(file, meta) {
  return {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'X-Crop-Meta': encodeURIComponent(JSON.stringify(meta)),
    },
    stream: fs.createReadStream(file),
    length: fs.statSync(file).size,
  };
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function jsonError(error) {
  return { status: error?.status || 400, json: { error: error instanceof Error ? error.message : String(error) } };
}
