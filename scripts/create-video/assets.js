import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { projectRoot, resolveProjectPath } from './config.js';

export const dataDir = path.join(projectRoot, 'public/data');
export const videosDir = path.join(projectRoot, 'public/videos');
export const cacheRoot = path.join(projectRoot, 'cache/createVideo');

export async function cacheThumbnail(videoId, config) {
  if (!config.cards.thumbnail?.enabled || !videoId) return null;
  const dir = path.join(cacheRoot, 'thumbnails');
  const outPath = path.join(dir, `${videoId}.jpg`);
  if (fs.existsSync(outPath)) return outPath;

  fs.mkdirSync(dir, { recursive: true });
  const urls = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) continue;
      fs.writeFileSync(outPath, bytes);
      return outPath;
    } catch (err) {
      console.warn(`⚠️ サムネイル取得をスキップ: ${videoId} (${err.message})`);
    }
  }

  return null;
}

export function downloadHighQuality(clip, outputPath, { normalize = false } = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const url = `https://www.youtube.com/watch?v=${clip.videoId}`;
  const normalizer = normalize ? resolveFfmpegNormalize() : null;
  // 正規化する場合は一旦 raw を落として ffmpeg-normalize で cache 本体へ書き出す。
  const downloadTarget = normalizer ? `${outputPath}.raw.mp4` : outputPath;

  execFileSync('yt-dlp', [
    '-f',
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--download-sections',
    `*${clip.startTime}-${clip.endTime}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format',
    'mp4',
    '-o',
    downloadTarget,
    url,
  ], { stdio: 'inherit' });

  if (!normalizer) {
    if (normalize) {
      console.warn('⚠️ ffmpeg-normalize が見つからないため音量正規化をスキップします（pip install ffmpeg-normalize）。');
    }
    return;
  }

  // 音声のみ EBU R128 正規化（既定 -23 LUFS。public/videos の download.js と同基準）。映像は copy で高画質維持。
  console.log('🔊 音量正規化中 (ffmpeg-normalize)...');
  try {
    execFileSync(normalizer, [
      downloadTarget,
      '-o', outputPath,
      '-f',
      '-c:a', 'aac', '-b:a', '192k',
      '-c:v', 'copy',
    ], { stdio: 'inherit' });
  } catch (err) {
    console.warn(`⚠️ 音量正規化に失敗したため生ダウンロードを使用します: ${err.message}`);
    fs.copyFileSync(downloadTarget, outputPath);
  } finally {
    fs.rmSync(downloadTarget, { force: true });
  }
}

function resolveFfmpegNormalize() {
  const candidates = [process.env.FFMPEG_NORMALIZE_BIN, 'ffmpeg-normalize'].filter(Boolean);
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

export function optionalAsset(assetPath, label) {
  const resolved = resolveProjectPath(assetPath);
  if (resolved && fs.existsSync(resolved)) return resolved;
  if (assetPath) console.warn(`⚠️ ${label} が見つからないためスキップします: ${assetPath}`);
  return null;
}
