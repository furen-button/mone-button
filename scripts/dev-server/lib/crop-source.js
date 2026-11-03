import fs from 'node:fs';
import path from 'node:path';

// 切り出しツール（crop.html）が扱う元動画の参照。ブラウザには実パスを渡さず、次の 3 種類の文字列で指す。
//   upload:<id>   … ドロップしてアップロードした動画（cache/crop/uploads/<id>.<ext>）
//   cache:<base>  … createVideo の高画質キャッシュ（cache/createVideo/<videoId>/<base>.mp4）
//   public:<base> … サイト用の低解像度動画（public/videos/<base>.mp4）

const UPLOAD_ID_PATTERN = /^[a-z0-9]{6,16}-[0-9a-f]{8}$/u;
const CLIP_BASE_PATTERN = /^[\w-]+$/u;
const VIDEO_ID_PATTERN = /^[\w-]{6,20}$/u;
const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};
export const UPLOAD_EXTENSIONS = Object.keys(CONTENT_TYPES);

export function cropDirs(projectRoot) {
  return {
    uploads: path.join(projectRoot, 'cache/crop/uploads'),
    jobs: path.join(projectRoot, 'cache/crop/jobs'),
    stills: path.join(projectRoot, 'cache/crop/stills'),
    output: path.join(projectRoot, 'output/crop'),
    data: path.join(projectRoot, 'public/data'),
    videos: path.join(projectRoot, 'public/videos'),
    cache: path.join(projectRoot, 'cache/createVideo'),
  };
}

export function newUploadId(now = Date.now(), random = Math.random) {
  const hex = Math.floor(random() * 0x100000000).toString(16).padStart(8, '0');
  return `${now.toString(36)}-${hex}`;
}

// 参照を { file, baseDir, contentType, label } にする。存在確認・シンボリックリンクの拒否は呼び出し側
// （files.js の resolveOutputFile）が基底ディレクトリと合わせて行う。形式が不正なら null。
export function resolveCropRef(projectRoot, ref) {
  const match = typeof ref === 'string' ? /^(upload|cache|public):(.+)$/u.exec(ref) : null;
  if (!match) {
    return null;
  }
  const [, type, id] = match;
  const dirs = cropDirs(projectRoot);
  if (type === 'upload') {
    if (!UPLOAD_ID_PATTERN.test(id)) {
      return null;
    }
    const ext = UPLOAD_EXTENSIONS.find((candidate) => fs.existsSync(path.join(dirs.uploads, `${id}${candidate}`)));
    if (!ext) {
      return null;
    }
    const meta = readJson(path.join(dirs.uploads, `${id}.json`));
    return {
      file: path.join(dirs.uploads, `${id}${ext}`),
      baseDir: dirs.uploads,
      contentType: CONTENT_TYPES[ext],
      label: typeof meta?.name === 'string' ? path.basename(meta.name, path.extname(meta.name)) : id,
    };
  }
  if (!CLIP_BASE_PATTERN.test(id)) {
    return null;
  }
  if (type === 'public') {
    return { file: path.join(dirs.videos, `${id}.mp4`), baseDir: dirs.videos, contentType: 'video/mp4', label: id };
  }
  const videoId = readJson(path.join(dirs.data, `${id}.json`))?.videoId;
  if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }
  const baseDir = path.join(dirs.cache, videoId);
  return { file: path.join(baseDir, `${id}.mp4`), baseDir, contentType: 'video/mp4', label: id };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
