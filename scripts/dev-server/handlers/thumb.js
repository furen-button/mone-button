import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeProject, normalizeRecipe } from '../../create-video/thumbnail.js';
import { thumbnailPathsFor } from '../../create-video/summary.js';
import { escapeFilterPath, stripEmoji } from '../../create-video/ass.js';
import { exportEnhance } from '../../create-video/camera-render.js';
import { probeVideoStream, resolveFfmpeg } from '../../create-video/ffmpeg.js';
import { writeBounded } from '../lib/bounded-write.js';
import { thumbnailDirs, outputVideo, outputSidecar, safeFile, regularFile } from '../lib/thumbnail-paths.js';
import { safeStem } from '../lib/file-names.js';
import { resolveOutputFile } from './files.js';

const execAsync = promisify(execFile);
const TEMPLATE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/u;
let tools;
function ffmpegTools() {
  tools ??= resolveFfmpeg();
  return tools;
}
function bad(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function json(value) {
  return { status: 200, json: value };
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function names(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
function checked(context, file) {
  if (!safeFile(context.projectRoot, file)) {
    bad('安全でない保存先です。');
  }
  return file;
}
function writeJson(context, file, value) {
  checked(context, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.${crypto.randomBytes(8).toString('hex')}.part`;
  try {
    fs.writeFileSync(partial, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(partial, file);
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

export function createThumbnailRoutes(context, deps = {}) {
  const route = (method, endpoint, handler, rawBody) => ({
    method,
    pattern: new RegExp(`^/thumbnail/${endpoint}$`, 'u'),
    rawBody,
    handler: async (req) => {
      try {
        return json(await handler(req));
      } catch (error) {
        return { status: error.status || 400, json: { error: error.message } };
      }
    },
  });
  return [
    route('GET', 'outputs', () => thumbnailOutputs(context)),
    route('GET', 'context', (req) => thumbnailContext(context, req.query.get('name'))),
    route('GET', 'assets', () => assets(context, deps)),
    route('GET', 'templates', () => templates(context)),
    route('POST', 'frame', (req) => extractFrame(context, req.body, req.signal, deps)),
    route('POST', 'image', (req) => uploadImage(context, req), ['image/png', 'image/jpeg', 'image/webp']),
    route('POST', 'project', (req) => {
      const file = targetPaths(context, req.body?.target).json;
      writeJson(context, file, normalizeProject(req.body?.project));
      return { saved: true };
    }),
    route(
      'POST',
      'save',
      async (req) => {
        const format = req.query.get('format');
        if (!['jpg', 'png'].includes(format)) {
          bad('format は jpg / png です。');
        }
        if (req.headers['content-type']?.split(';')[0] !== (format === 'jpg' ? 'image/jpeg' : 'image/png')) {
          bad('画像形式と Content-Type が一致しません。', 415);
        }
        const file = targetPaths(context, req.query.get('target'))[format];
        await writeBounded(req, checked(context, file), 2 * 1024 ** 2);
        return { saved: true, name: path.basename(file) };
      },
      ['image/jpeg', 'image/png'],
    ),
    route('POST', 'template', (req) => {
      const { name, template } = req.body || {};
      if (typeof name !== 'string' || !TEMPLATE_NAME.test(name)) {
        bad('テンプレート名は半角英数字とハイフン（最大41文字）です。');
      }
      writeJson(
        context,
        path.join(thumbnailDirs(context).templates, `${name}.json`),
        normalizeProject(template, { template: true }),
      );
      return { saved: true };
    }),
  ];
}

export function targetPaths(context, target) {
  if (typeof target !== 'string' || target.length > 240) {
    bad('保存先を指定してください。');
  }
  let video;
  if (target.startsWith('name:')) {
    video = path.join(context.outputDir, 'thumbnails', `${safeStem(target.slice(5))}.mp4`);
  } else {
    video = outputVideo(context, target);
  }
  if (!video) {
    bad('出力が見つかりません。', 404);
  }
  const result = thumbnailPathsFor(video);
  for (const file of Object.values(result)) {
    checked(context, file);
  }
  return result;
}
export function thumbnailOutputs(context) {
  const result = [];
  const seen = new Set();
  for (const dir of [context.outputDir, path.join(context.outputDir, '0_reviewed')]) {
    for (const file of names(dir).filter((name) => name.endsWith('.mp4'))) {
      const base = file.slice(0, -4);
      if (seen.has(base)) {
        continue;
      }
      const video = outputVideo(context, base);
      if (!video) {
        continue;
      }
      seen.add(base);
      const paths = thumbnailPathsFor(video);
      result.push({
        base,
        reviewed: path.dirname(video) !== context.outputDir,
        mtimeMs: fs.statSync(video).mtimeMs,
        thumbnail: [paths.jpg, paths.png].some((p) => regularFile(context.projectRoot, p)),
      });
    }
  }
  return result.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
export function thumbnailContext(context, name) {
  if (!outputVideo(context, name)) {
    bad('出力が見つかりません。', 404);
  }
  const meta = readJson(outputSidecar(context, name, 'meta.json')) || {};
  const render = readJson(outputSidecar(context, name, 'render.json')) || {};
  const seen = new Set();
  const clips = (render.segments || [])
    .filter((s) => s.kind === 'clip' && typeof s.base === 'string' && !seen.has(s.base) && seen.add(s.base))
    .map((s) => {
      const source = `cache:${s.base}`;
      return {
        base: s.base,
        serif: (s.telops || []).find((t) => t.name === 'serif')?.text || '',
        duration: s.expectedSec || s.durationSec || 0,
        source: resolveOutputFile(context, 'crop-source', source) ? source : null,
      };
    });
  const category = render.select?.mode === 'category' ? render.select.categories?.[0] : null;
  const title =
    meta.titleCandidates?.[0] ||
    (category ? `{${category}}集` : stripEmoji(meta.chapters?.[0]?.label || meta.chapters?.[0]?.title || ''));
  const saved = readJson(targetPaths(context, name).json);
  return { title, clips, project: saved ? normalizeProject(saved) : null };
}
function templates(context) {
  const dir = thumbnailDirs(context).templates;
  return names(dir)
    .filter(
      (name) =>
        name.endsWith('.json') &&
        TEMPLATE_NAME.test(name.slice(0, -5)) &&
        regularFile(context.projectRoot, path.join(dir, name)),
    )
    .map((name) => ({
      name: name.slice(0, -5),
      template: normalizeProject(readJson(path.join(dir, name)), { template: true }),
    }));
}

async function assets(context, deps) {
  const root = path.join(context.projectRoot, 'public/face-focus');
  const index = readJson(path.join(root, 'index.json'));
  const dirs = thumbnailDirs(context);
  const faces = [];
  for (const kind of names(root).filter((name) => /^[a-z0-9-]+$/u.test(name))) {
    for (const file of names(path.join(root, kind, 'crop')).filter((name) => /^[\w-]+\.png$/u.test(name))) {
      const source = path.join(root, kind, 'crop', file);
      if (!regularFile(context.projectRoot, source)) {
        continue;
      }
      const stat = fs.statSync(source);
      const key = crypto
        .createHash('sha1')
        .update(JSON.stringify([kind, file, stat.size, stat.mtimeMs]))
        .digest('hex');
      const preview = checked(context, path.join(dirs.previews, `${key}.png`));
      if (!fs.existsSync(preview)) {
        fs.mkdirSync(dirs.previews, { recursive: true });
        const partial = `${preview}.${crypto.randomBytes(8).toString('hex')}.png`;
        try {
          await (deps.exec || execAsync)((deps.tools || ffmpegTools()).ffmpeg, [
            '-v',
            'error',
            '-y',
            '-i',
            source,
            '-vf',
            'scale=256:256:force_original_aspect_ratio=decrease',
            '-frames:v',
            '1',
            partial,
          ]);
          fs.renameSync(partial, preview);
        } finally {
          fs.rmSync(partial, { force: true });
        }
      }
      const item = index?.items?.find((i) => i.video === kind && i.kind === 'crop' && path.basename(i.path) === file);
      faces.push({ src: `face:${kind}/${file}`, preview: `preview:${key}`, kind, rating: item?.rating || 0 });
    }
  }
  const images = names(dirs.images)
    .filter(
      (name) =>
        /^[0-9a-f]{32}\.(png|jpg|webp)$/u.test(name) && regularFile(context.projectRoot, path.join(dirs.images, name)),
    )
    .map((name) => ({ src: `image:${name.split('.')[0]}` }));
  return { faces: faces.sort((a, b) => b.rating - a.rating), images, templates: templates(context) };
}
async function uploadImage(context, req) {
  const type = req.headers['content-type']?.split(';')[0];
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
  if (!ext) {
    bad('PNG / JPEG / WebP を指定してください。', 415);
  }
  const id = crypto.randomBytes(16).toString('hex');
  const file = checked(context, path.join(thumbnailDirs(context).images, `${id}.${ext}`));
  await writeBounded(req, file, 20 * 1024 ** 2);
  try {
    const info = probeVideoStream(ffmpegTools().ffprobe, file);
    if (!(info?.width > 0 && info?.height > 0) || info.width * info.height > 40000000) {
      bad('画像が読めないか、4000万画素を超えています。', 422);
    }
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  return { src: `image:${id}` };
}

export async function extractFrame(context, body, signal, deps = {}) {
  const recipe = normalizeRecipe(body);
  const target = resolveOutputFile(context, 'crop-source', recipe.source);
  if (!target) {
    bad('高画質キャッシュがありません。', 404);
  }
  const key = crypto
    .createHash('sha1')
    .update(JSON.stringify([target.path, target.size, target.mtimeMs, recipe]))
    .digest('hex');
  const out = checked(context, path.join(thumbnailDirs(context).frames, `${key}.png`));
  const metaPath = `${out}.json`;
  const cached = readJson(metaPath);
  if (fs.existsSync(out) && cached) {
    return { src: `frame:${key}`, recipe, ...cached, cached: true };
  }
  const ff = deps.tools || ffmpegTools();
  const info = (deps.probe || probeVideoStream)(ff.ffprobe, target.path);
  if (!(info.width > 0 && info.height > 0) || (info.duration && recipe.at >= info.duration)) {
    bad('時刻または動画の寸法が不正です。');
  }
  const ratio = Math.min(recipe.upscale === 'anime4k' ? 2 : 1, 2560 / info.width, 1440 / info.height);
  const width = Math.max(1, Math.round(info.width * ratio));
  const height = Math.max(1, Math.round(info.height * ratio));
  const enhance =
    recipe.upscale === 'anime4k'
      ? await (deps.enhance || exportEnhance)({ tools: ff, sourceMp4: target.path, probe: info })
      : null;
  const fallbackFilter = `scale=${width}:${height}:flags=lanczos,setsar=1,format=rgb24`;
  const filter = enhance?.applied
    ? [
        `scale=${info.width}:${info.height}`,
        'setsar=1',
        ...(enhance.restorePreset
          ? [`libplacebo=custom_shader_path='${escapeFilterPath(enhance.restorePreset)}':format=rgb24:dithering=none`]
          : []),
        `libplacebo=w=${width}:h=${height}:custom_shader_path='${escapeFilterPath(enhance.upscalePreset)}':upscaler=ewa_lanczossharp:format=rgb24:dithering=none`,
      ].join(',')
    : fallbackFilter;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const partial = `${out}.${crypto.randomBytes(8).toString('hex')}.png`;
  let applied = Boolean(enhance?.applied);
  let reason = recipe.upscale === 'anime4k' && !applied ? enhance?.reason || 'Anime4K を利用できません。' : null;
  const run = (vf) =>
    (deps.exec || execAsync)(
      ff.ffmpeg,
      [
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-ss',
        String(recipe.at),
        '-i',
        target.path,
        '-frames:v',
        '1',
        '-vf',
        vf,
        partial,
      ],
      { signal },
    );
  try {
    try {
      await run(filter);
    } catch (error) {
      if (!applied || signal?.aborted) {
        throw error;
      }
      applied = false;
      reason = 'Anime4K の描画に失敗したため Lanczos を使用しました。';
      await run(fallbackFilter);
    }
    fs.renameSync(partial, out);
    const meta = { width, height, applied, fallback: recipe.upscale === 'anime4k' && !applied, reason };
    writeJson(context, metaPath, meta);
    return { src: `frame:${key}`, recipe, ...meta, cached: false };
  } finally {
    fs.rmSync(partial, { force: true });
  }
}
