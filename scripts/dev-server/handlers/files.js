import fs from 'node:fs';
import path from 'node:path';

import { contactSheetPathFor } from '../../create-video/qc/contact.js';
import { manifestPathFor, reportPathsFor } from '../../create-video/qc/manifest.js';
import { summaryPathsFor } from '../../create-video/summary.js';
import { outputBaseName } from '../lib/guards.js';

const VIDEO_ID_PATTERN = /^[\w-]{6,20}$/u;
const HASH_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_COMMENT_PARTS = 99;

export function createFileRoutes(context) {
  return [
    { method: 'GET', pattern: /^\/file$/u, handler: async (req) => serveFile(context, req) },
    { method: 'HEAD', pattern: /^\/file$/u, handler: async (req) => serveFile(context, req) },
    { method: 'GET', pattern: /^\/outputs$/u, handler: async () => listOutputs(context) },
    { method: 'GET', pattern: /^\/result$/u, handler: async (req) => getResult(context, req.query.get('name')) },
  ];
}

// kind ごとに基底ディレクトリと拡張子を固定し、name は basename だけを受ける。
// output 配下の名前は createVideo 側のパス関数（manifestPathFor など）で組み、命名の正本を 1 つに保つ。
export function resolveOutputFile(context, kind, name, index) {
  const mp4 = (base) => path.join(context.outputDir, `${base}.mp4`);
  const outputKinds = {
    mp4: (base) => ({ file: mp4(base), type: 'video/mp4' }),
    contact: (base) => ({ file: contactSheetPathFor(mp4(base)), type: 'image/png' }),
    render: (base) => ({ file: manifestPathFor(mp4(base)), type: 'application/json; charset=utf-8' }),
    'qc-json': (base) => ({ file: reportPathsFor(mp4(base)).json, type: 'application/json; charset=utf-8' }),
    'qc-md': (base) => ({ file: reportPathsFor(mp4(base)).md, type: 'text/markdown; charset=utf-8' }),
    youtube: (base) => ({ file: summaryPathsFor(mp4(base)).youtube, type: 'text/plain; charset=utf-8' }),
    meta: (base) => ({ file: summaryPathsFor(mp4(base)).meta, type: 'application/json; charset=utf-8' }),
    comment: (base) => ({
      file: index ? path.join(context.outputDir, `${base}.comment-${index}.txt`) : summaryPathsFor(mp4(base)).comment,
      type: 'text/plain; charset=utf-8',
    }),
    log: (base) => ({ file: path.join(context.outputDir, 'logs', `${base}.log`), type: 'text/plain; charset=utf-8' }),
  };

  let resolved = null;
  let baseDir = null;
  if (kind in outputKinds) {
    const base = outputBaseName(name);
    if (!base) {
      return null;
    }
    if (index !== undefined && index !== null && (!Number.isInteger(index) || index < 1 || index > MAX_COMMENT_PARTS)) {
      return null;
    }
    resolved = outputKinds[kind](base);
    baseDir = kind === 'log' ? path.join(context.outputDir, 'logs') : context.outputDir;
  } else if (kind === 'thumb') {
    if (typeof name !== 'string' || !VIDEO_ID_PATTERN.test(name)) {
      return null;
    }
    baseDir = path.join(context.projectRoot, 'cache/createVideo/thumbnails');
    resolved = { file: path.join(baseDir, `${name}.jpg`), type: 'image/jpeg' };
  } else if (kind === 'still' || kind === 'sheet') {
    if (typeof name !== 'string' || !HASH_PATTERN.test(name)) {
      return null;
    }
    baseDir = path.join(context.cacheDir, kind === 'still' ? 'stills' : 'sheets');
    resolved = { file: path.join(baseDir, `${name}.png`), type: 'image/png' };
  } else {
    return null;
  }

  // 解決後の実パスが基底ディレクトリ直下に収まること、実ファイル（ディレクトリ・シンボリックリンク以外）であることを確認する。
  if (path.dirname(resolved.file) !== baseDir) {
    return null;
  }
  let stat;
  try {
    stat = fs.lstatSync(resolved.file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return null;
  }
  return { path: resolved.file, contentType: resolved.type, size: stat.size, mtimeMs: stat.mtimeMs };
}

// Range: bytes=a-b / a- / -n。<video> のシークには 206 応答が必要。
export function parseRange(header, size) {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return { invalid: true };
  }
  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end };
}

async function serveFile(context, req) {
  const kind = req.query.get('kind');
  const name = req.query.get('name');
  const indexRaw = req.query.get('index');
  const index = indexRaw === null ? undefined : Number(indexRaw);
  const target = resolveOutputFile(context, kind, name, index);
  if (!target) {
    return { status: 400, json: { error: 'invalid file request' } };
  }

  const headers = {
    'Content-Type': target.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  const range = parseRange(req.headers.range, target.size);
  if (range?.invalid) {
    return { status: 416, headers: { 'Content-Range': `bytes */${target.size}` }, json: { error: 'range not satisfiable' } };
  }
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${target.size}`;
    return {
      status: 206,
      headers,
      stream: fs.createReadStream(target.path, { start: range.start, end: range.end }),
      length: range.end - range.start + 1,
    };
  }
  return { status: 200, headers, stream: fs.createReadStream(target.path), length: target.size };
}

async function listOutputs(context) {
  if (!fs.existsSync(context.outputDir)) {
    return { status: 200, json: [] };
  }
  const outputs = fs.readdirSync(context.outputDir)
    .filter((file) => file.endsWith('.mp4'))
    .map((file) => {
      const base = path.basename(file, '.mp4');
      const stat = fs.statSync(path.join(context.outputDir, file));
      return { base, mtimeMs: stat.mtimeMs, size: stat.size, sidecars: sidecarsFor(context, base) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { status: 200, json: outputs };
}

export function sidecarsFor(context, base) {
  const mp4 = path.join(context.outputDir, `${base}.mp4`);
  const report = reportPathsFor(mp4);
  const summary = summaryPathsFor(mp4);
  return {
    render: fs.existsSync(manifestPathFor(mp4)),
    qcJson: fs.existsSync(report.json),
    qcMd: fs.existsSync(report.md),
    contact: fs.existsSync(contactSheetPathFor(mp4)),
    youtube: fs.existsSync(summary.youtube),
    meta: fs.existsSync(summary.meta),
    comments: commentFilesFor(context, base),
  };
}

function commentFilesFor(context, base) {
  const single = `${base}.comment.txt`;
  if (fs.existsSync(path.join(context.outputDir, single))) {
    return [single];
  }
  const parts = [];
  for (let i = 1; i <= MAX_COMMENT_PARTS; i += 1) {
    const name = `${base}.comment-${i}.txt`;
    if (!fs.existsSync(path.join(context.outputDir, name))) {
      break;
    }
    parts.push(name);
  }
  return parts;
}

async function getResult(context, name) {
  const base = outputBaseName(name);
  if (!base) {
    return { status: 400, json: { error: 'invalid output name' } };
  }
  const mp4Path = path.join(context.outputDir, `${base}.mp4`);
  const mp4 = fs.existsSync(mp4Path) ? statSummary(mp4Path) : null;
  const report = reportPathsFor(mp4Path);
  const summary = summaryPathsFor(mp4Path);
  const sidecars = sidecarsFor(context, base);
  const render = readJson(manifestPathFor(mp4Path));

  return {
    status: 200,
    json: {
      base,
      mp4,
      sidecars,
      qc: readJson(report.json),
      qcMd: readText(report.md),
      youtube: readText(summary.youtube),
      comments: sidecars.comments.map((file) => readText(path.join(context.outputDir, file)) ?? ''),
      meta: readJson(summary.meta),
      render: render
        ? {
            clipCount: render.clipCount ?? null,
            totalSec: render.totalSec ?? null,
            concatMethod: render.concatMethod ?? null,
            configPath: render.configPath ?? null,
            generatedAt: render.generatedAt ?? null,
          }
        : null,
    },
  };
}

function statSummary(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
