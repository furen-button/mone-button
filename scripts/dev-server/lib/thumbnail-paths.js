import { safeStem } from './file-names.js';
import fs from 'node:fs';
import path from 'node:path';
import { parseAssetRef } from '../../create-video/thumbnail.js';
import { thumbnailPathsFor } from '../../create-video/summary.js';
import { outputBaseName } from './guards.js';

export function thumbnailDirs(context) {
  return {
    frames: path.join(context.projectRoot, 'cache/thumbnail/frames'),
    previews: path.join(context.projectRoot, 'cache/thumbnail/previews'),
    images: path.join(context.outputDir, 'thumbnail-assets'),
    templates: path.join(context.projectRoot, 'scripts/create-video/thumbnail-templates'),
  };
}
// 親ディレクトリのシンボリックリンクも拒否する。書き込み先が未作成でも使用できる。
export function safeFile(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }
  let current = root;
  for (const part of ['', ...relative.split(path.sep)]) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        return false;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return false;
      }
    }
  }
  return true;
}
export function regularFile(root, file) {
  return safeFile(root, file) && fs.existsSync(file) && fs.statSync(file).isFile();
}
export function outputVideo(context, name) {
  if (!outputBaseName(name)) {
    return null;
  }
  return (
    [context.outputDir, path.join(context.outputDir, '0_reviewed')]
      .map((dir) => path.join(dir, `${name}.mp4`))
      .find((file) => regularFile(context.projectRoot, file)) || null
  );
}
export function outputSidecar(context, name, suffix) {
  const video = outputVideo(context, name);
  if (!video) {
    return null;
  }
  return videoSidecar(context, video, suffix);
}

// 明示した動画の隣を最優先にする。CLI からサブディレクトリの動画を指定する場合も共用する。
export function videoSidecar(context, video, suffix) {
  const name = path.basename(video, path.extname(video));
  return (
    [path.dirname(video), context.outputDir, path.join(context.outputDir, '0_reviewed')]
      .flatMap((dir) => [suffix].flat().map((ext) => path.join(dir, `${name}.${ext}`)))
      .find((file) => regularFile(context.projectRoot, file)) || null
  );
}
export function thumbnailAsset(context, ref) {
  const parsed = parseAssetRef(ref);
  const dirs = thumbnailDirs(context);
  if (!parsed) {
    if (typeof ref === 'string' && /^preview:[0-9a-f]{40}$/u.test(ref)) {
      return { file: path.join(dirs.previews, `${ref.slice(8)}.png`), type: 'image/png', baseDir: dirs.previews };
    }
    return null;
  }
  if (parsed.type === 'frame') {
    return { file: path.join(dirs.frames, `${parsed.id}.png`), type: 'image/png', baseDir: dirs.frames };
  }
  if (parsed.type === 'face') {
    const [kind, file] = parsed.id.split('/');
    const baseDir = path.join(context.projectRoot, 'public/face-focus', kind, 'crop');
    return { file: path.join(baseDir, file), type: 'image/png', baseDir };
  }
  for (const [ext, type] of [
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ]) {
    const file = path.join(dirs.images, `${parsed.id}.${ext}`);
    if (regularFile(context.projectRoot, file)) {
      return { file, type, baseDir: dirs.images };
    }
  }
  return null;
}
export function thumbnailOutput(context, name, format = 'jpg') {
  if (!['jpg', 'png', 'json'].includes(format)) {
    return null;
  }
  const video =
    typeof name === 'string' && name.startsWith('name:')
      ? path.join(context.outputDir, 'thumbnails', `${safeStem(name.slice(5))}.mp4`)
      : outputVideo(context, name);
  if (!video) {
    return null;
  }
  return thumbnailPathsFor(video)[format];
}
