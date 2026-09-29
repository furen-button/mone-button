import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { projectRoot, resolveProjectPath } from './config.js';
import { AUDIO_RESAMPLE } from './ffmpeg.js';

export const dataDir = path.join(projectRoot, 'public/data');
export const videosDir = path.join(projectRoot, 'public/videos');
export const cacheRoot = path.join(projectRoot, 'cache/createVideo');

export async function cacheThumbnail(videoId, config, { allowDownload = true } = {}) {
  if (!config.cards.thumbnail?.enabled || !videoId) return null;
  const dir = path.join(cacheRoot, 'thumbnails');
  const outPath = path.join(dir, `${videoId}.jpg`);
  if (fs.existsSync(outPath)) return outPath;
  // 静止画プレビューは取得済みのものだけを使う（プレビューで外に取りに行かない）。
  if (!allowDownload) {
    return null;
  }

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

// 映像・音声ストリームの尺（秒）。取れないときは null。
export function probeStreamDurations({ ffprobe, filePath }) {
  try {
    const raw = execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,duration',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf8' });
    const streams = JSON.parse(raw).streams || [];
    const video = Number(streams.find((stream) => stream.codec_type === 'video')?.duration);
    const audio = Number(streams.find((stream) => stream.codec_type === 'audio')?.duration);
    if (!Number.isFinite(video) || !Number.isFinite(audio)) {
      return null;
    }
    return { video, audio };
  } catch {
    return null;
  }
}

// 音声ストリーム尺 − 映像ストリーム尺（ms）。取れないときは null。
export function audioVideoGapMs({ ffprobe, filePath }) {
  const durations = probeStreamDurations({ ffprobe, filePath });
  return durations ? (durations.audio - durations.video) * 1000 : null;
}

// 音声パケットの pts の穴（ms）。最終パケット以外で、最頻の duration より長いパケットの
// 超過分を合計する。yt-dlp の区間切り出しで作った 96kHz 音声に数十 ms の穴が混ざる。
export function audioPtsHoleMs({ ffprobe, filePath }) {
  try {
    const timeBase = execFileSync(ffprobe, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=time_base',
      '-of', 'csv=p=0',
      filePath,
    ], { encoding: 'utf8' }).trim();
    const [num, den] = String(timeBase || '0/1').split('/').map(Number);
    // パケット数は 15 分の動画で 4 万行になる。JSON だと 1MB を超えて execFileSync の
    // 既定バッファに掛かるので、1 行 1 値の csv で取り、バッファも広げる。
    const raw = execFileSync(ffprobe, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'packet=duration',
      '-of', 'csv=p=0',
      filePath,
    ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const durations = raw.trim().split(/\r?\n/).map(Number).filter(Number.isFinite).slice(0, -1);
    if (!den || durations.length < 2) {
      return null;
    }
    const counts = new Map();
    for (const duration of durations) {
      counts.set(duration, (counts.get(duration) || 0) + 1);
    }
    const normal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const excess = durations.reduce((sum, duration) => sum + Math.max(0, duration - normal), 0);
    return excess * num / den * 1000;
  } catch {
    return null;
  }
}

// 音声を映像に揃える（映像は copy のまま）。pts の穴を無音で埋めて連続にし、連結側と
// 同じ atrim / apad で映像ストリーム尺ちょうどに切り詰め / 無音パディングする。
// -shortest は AAC のフレーム粒度で ±1 フレーム（約 23ms）残るので使わない。
// yt-dlp の区間切り出しや音量正規化で生じる穴と A/V 尺差をキャッシュの時点で潰す。
// 尺差の許容は AAC 1 フレーム（1024/44100 ≒ 23.2ms）。それ未満は再生に影響せず、直しても
// AAC の再エンコードが 1 回増えるだけなので触らない。穴は 1ms 超なら必ず埋める。
export const ALIGN_GAP_TOLERANCE_MS = 24;
export const ALIGN_HOLE_TOLERANCE_MS = 1;

export function alignAudioToVideo({ ffmpeg, ffprobe, filePath, toleranceMs = ALIGN_GAP_TOLERANCE_MS }) {
  const durations = probeStreamDurations({ ffprobe, filePath });
  const gapMs = durations ? (durations.audio - durations.video) * 1000 : null;
  const holeMs = audioPtsHoleMs({ ffprobe, filePath });
  const needsGap = gapMs !== null && Math.abs(gapMs) > toleranceMs;
  const needsHole = holeMs !== null && holeMs > ALIGN_HOLE_TOLERANCE_MS;
  if (!needsGap && !needsHole) {
    return { aligned: false, gapMs, holeMs };
  }
  const tmpPath = `${filePath}.align.mp4`;
  const slot = durations.video.toFixed(6);
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-i', filePath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-af', `${AUDIO_RESAMPLE},atrim=0:${slot},apad=whole_dur=${slot}`,
      '-movflags', '+faststart',
      tmpPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.renameSync(tmpPath, filePath);
    return { aligned: true, gapMs, holeMs };
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    const reason = String(err.stderr || err.message || '').trim().split(/\r?\n/).pop() || 'unknown';
    console.warn(`⚠️ 音声の揃え直しに失敗しました: ${path.basename(filePath)} (${reason})`);
    return { aligned: false, gapMs, holeMs, error: reason };
  }
}

export function downloadHighQuality(clip, outputPath, { normalize = false, tools = null } = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const url = `https://www.youtube.com/watch?v=${clip.videoId}`;
  const normalizer = normalize ? resolveFfmpegNormalize() : null;
  // 正規化する場合は一旦 raw を落として ffmpeg-normalize で cache 本体へ書き出す。
  const downloadTarget = normalizer ? `${outputPath}.raw.mp4` : outputPath;

  execFileSync('yt-dlp', [
    '-f',
    // 96kHz の m4a は区間切り出しで pts の穴が入りやすいので 48kHz 以下を優先する。無ければ従来どおり。
    'bestvideo[ext=mp4]+bestaudio[ext=m4a][asr<=48000]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--download-sections',
    `*${clip.startTime}-${clip.endTime}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format',
    'mp4',
    '-o',
    downloadTarget,
    url,
  ], { stdio: 'inherit' });

  if (normalizer) {
    // 音声のみ EBU R128 正規化（既定 -23 LUFS。public/videos の download.js と同基準）。映像は copy で高画質維持。
    console.log('🔊 音量正規化中 (ffmpeg-normalize)...');
    try {
      execFileSync(normalizer, [
        downloadTarget,
        '-o', outputPath,
        '-f',
        '-c:a', 'aac', '-b:a', '192k',
        // 96kHz などのソースが混ざると A/V 尺差が出やすいので、キャッシュの時点で 44.1kHz に固定する。
        '-ar', '44100',
        '-c:v', 'copy',
      ], { stdio: 'inherit' });
    } catch (err) {
      console.warn(`⚠️ 音量正規化に失敗したため生ダウンロードを使用します: ${err.message}`);
      fs.copyFileSync(downloadTarget, outputPath);
    } finally {
      fs.rmSync(downloadTarget, { force: true });
    }
  } else if (normalize) {
    console.warn('⚠️ ffmpeg-normalize が見つからないため音量正規化をスキップします（pip install ffmpeg-normalize）。');
  }

  // 正規化の有無にかかわらず、キャッシュに入る時点で音声長を映像長に揃える。
  if (tools?.ffmpeg && tools?.ffprobe) {
    const result = alignAudioToVideo({ ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, filePath: outputPath });
    if (result.aligned) {
      console.log(`🎚️ 音声を映像に揃えました（${describeAlign(result)}）`);
    }
  }
}

export function describeAlign({ gapMs, holeMs }) {
  const parts = [];
  if (Number.isFinite(gapMs)) {
    parts.push(`尺差 ${gapMs > 0 ? '+' : ''}${gapMs.toFixed(1)}ms`);
  }
  if (Number.isFinite(holeMs) && holeMs > 0) {
    parts.push(`pts の穴 ${holeMs.toFixed(1)}ms`);
  }
  return parts.join(' / ') || '差なし';
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
