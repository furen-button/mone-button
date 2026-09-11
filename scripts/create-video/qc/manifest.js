import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { elementRect, countLines } from '../ass.js';
import { projectRoot } from '../config.js';

export function manifestPathFor(videoOutPath) {
  const dir = path.dirname(videoOutPath);
  const base = path.basename(videoOutPath, path.extname(videoOutPath));
  return path.join(dir, `${base}.render.json`);
}

export function reportPathsFor(videoOutPath) {
  const dir = path.dirname(videoOutPath);
  const base = path.basename(videoOutPath, path.extname(videoOutPath));
  return {
    json: path.join(dir, `${base}.qc.json`),
    md: path.join(dir, `${base}.qc.md`),
  };
}

export async function readManifestFor(videoOutPath, explicitPath = null, { allowStaleManifest = false } = {}) {
  const manifestPath = explicitPath || manifestPathFor(videoOutPath);
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, path: manifestPath, missing: true, results: [] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    manifest,
    path: manifestPath,
    missing: false,
    results: await verifyManifestVideo({ videoOutPath, manifest, allowStaleManifest }),
  };
}

export async function buildRenderManifest({
  videoOutPath,
  config,
  clips,
  renderedSegments,
  concatMethod,
  totalSec,
  size,
}) {
  const identity = await videoIdentityFor(videoOutPath);
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    video: relativePath(videoOutPath),
    videoBytes: identity.videoBytes,
    videoSha256: identity.videoSha256,
    configPath: config.__meta?.configPath ? relativePath(config.__meta.configPath) : null,
    select: selectManifest(config),
    source: config.source,
    signature: {
      width: size.width,
      height: size.height,
      fps: size.fps,
    },
    concatMethod,
    totalSec: roundSec(totalSec),
    segments: renderedSegments.map((segment) => segmentManifest(segment, size)),
    clipCount: clips.length,
  };
}

export async function writeRenderManifest(args) {
  const manifest = await buildRenderManifest(args);
  const outPath = manifestPathFor(args.videoOutPath);
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { path: outPath, manifest };
}

export async function videoIdentityFor(videoPath) {
  const stats = await fs.promises.stat(videoPath);
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(videoPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return {
    videoBytes: stats.size,
    videoSha256: hash.digest('hex'),
  };
}

export function relativePath(filePath) {
  if (!filePath) {
    return null;
  }
  const rel = path.relative(projectRoot, filePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : filePath;
}

function selectManifest(config) {
  if (config.select.mode === 'videoId') {
    return { mode: 'videoId', videoId: config.select.videoId };
  }
  if (config.select.mode === 'category') {
    return { mode: 'category', categories: [...config.select.categories] };
  }
  return { mode: 'files', files: [...config.select.files] };
}

async function verifyManifestVideo({ videoOutPath, manifest, allowStaleManifest }) {
  if (!manifest) {
    return [];
  }
  if (manifest.version !== 2 || manifest.videoBytes === undefined || !manifest.videoSha256) {
    return [result(
      'info',
      'manifest_stale_unverifiable',
      'render manifest が version 1 形式のため、陳腐化の確認ができません。該当 videoId で createVideo をやり直すと確認できます。',
    )];
  }

  const actual = await videoIdentityFor(videoOutPath);
  const expectedBytes = Number(manifest.videoBytes);
  const expectedSha256 = String(manifest.videoSha256);
  if (actual.videoBytes === expectedBytes && actual.videoSha256 === expectedSha256) {
    return [];
  }
  const message = [
    'render manifest が現在の mp4 と一致しません。',
    regenerationHint(manifest),
  ].join(' ');
  const detail = [
    `bytes: manifest=${expectedBytes} / mp4=${actual.videoBytes}`,
    `sha256: manifest=${expectedSha256} / mp4=${actual.videoSha256}`,
  ].join(' / ');
  if (allowStaleManifest) {
    return [result(
      'info',
      'manifest_stale_allowed',
      `${message} --allow-stale-manifest（検証用）により error にせず続行します。`,
      detail,
    )];
  }
  return [result('error', 'manifest_stale', message, detail)];
}

function regenerationHint(manifest) {
  if (manifest.select?.mode === 'videoId' && manifest.select.videoId) {
    return `該当 videoId で createVideo をやり直してください: npm run createVideo -- --videoId ${manifest.select.videoId} --qc`;
  }
  return '同じ選択条件で createVideo をやり直してください。';
}

function segmentManifest(segment, size) {
  const clip = segment.clip || {};
  const out = {
    kind: segment.kind,
    base: clip.base || segment.base || path.basename(segment.path, path.extname(segment.path)),
    videoId: clip.videoId || segment.videoId || '',
    atSec: roundSec(segment.atSec),
    durationSec: roundSec(segment.durationSec),
    sourcePath: relativePath(segment.sourcePath),
    telops: (segment.elements || []).map((el) => telopManifest(el, size)).filter(Boolean),
  };
  if (segment.zoom && !segment.zoom.skip) {
    out.zoom = {
      at: roundSec(segment.zoom.at),
      scale: Number(segment.zoom.scale),
      x: roundCoord(segment.zoom.focus?.x),
      y: roundCoord(segment.zoom.focus?.y),
    };
  }
  // 顔回避の判断を残す。見送り（fallback）は QC が warn で拾う。
  if (segment.avoid) {
    out.avoidFace = {
      applied: Boolean(segment.avoid.applied),
      ...(segment.avoid.side ? { side: segment.avoid.side } : {}),
      ...(segment.avoid.fallback ? { fallback: true } : {}),
      ...(segment.avoid.reason ? { reason: segment.avoid.reason } : {}),
      ...(segment.avoid.face ? { face: roundRect(segment.avoid.face) } : {}),
    };
  }
  // 補正（Anime4K）の判断を残す。見送り（fallback）は QC が warn で拾う。
  if (segment.enhance) {
    const enhance = segment.enhance;
    out.enhance = enhance.applied
      ? {
        applied: true,
        backend: enhance.backend,
        restore: enhance.restore || null,
        upscale: enhance.upscale || null,
        from: { w: Number(enhance.from?.w) || 0, h: Number(enhance.from?.h) || 0 },
      }
      : {
        applied: false,
        ...(enhance.fallback ? { fallback: true } : {}),
        ...(enhance.reason ? { reason: enhance.reason } : {}),
      };
  }
  return out;
}

function roundRect(rect) {
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
}

function telopManifest(el, size) {
  const rect = elementRect(el, size.width, size.height);
  if (!rect) {
    return null;
  }
  return {
    name: el.name,
    text: el.text,
    lines: countLines(el.text),
    fontSize: Number(el.size),
    rect,
    boxFill: el.box?.fill || null,
    boxEnabled: Boolean(el.box?.enabled),
    // 半透明ボックスは塗り色と映像が混ざるため、焼き込みの色一致率では判定できない。
    boxOpacity: el.box?.opacity === undefined ? 1 : Number(el.box.opacity),
  };
}

function roundSec(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function roundCoord(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function result(level, code, message, detail = null) {
  return { level, code, message, ...(detail ? { detail } : {}) };
}
