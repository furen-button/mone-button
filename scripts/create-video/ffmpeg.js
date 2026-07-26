import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { optionalAsset } from './assets.js';
import { escapeFilterPath } from './ass.js';

export function ffmpegHasSubtitles(bin) {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], { encoding: 'utf8' });
    return /\bsubtitles\b/.test(out);
  } catch {
    return false;
  }
}

export function resolveFfmpeg() {
  const candidates = [
    process.env.FFMPEG_BIN,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    'ffmpeg',
  ].filter(Boolean);

  for (const ffmpeg of candidates) {
    if (!ffmpegHasSubtitles(ffmpeg)) continue;
    return { ffmpeg, ffprobe: resolveFfprobe(ffmpeg) };
  }

  throw new Error([
    'subtitles(libass) フィルタ対応の ffmpeg が見つかりません。',
    'brew install ffmpeg-full を実行するか、FFMPEG_BIN でパスを指定してください。',
  ].join('\n'));
}

function resolveFfprobe(ffmpeg) {
  if (process.env.FFPROBE_BIN) return process.env.FFPROBE_BIN;
  if (ffmpeg.includes(path.sep)) {
    const sibling = path.join(path.dirname(ffmpeg), 'ffprobe');
    if (fs.existsSync(sibling)) return sibling;
  }
  return 'ffprobe';
}

export function encodeArgs(config) {
  return [
    '-r', String(config.output.fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
  ];
}

export function concatListLine(filePath) {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export function concatSegments({ tools, segments, outPath, workDir, config }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (segments.length === 1) {
    fs.copyFileSync(segments[0], outPath);
    return { method: 'copy-single', outPath };
  }

  const listPath = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listPath, segments.map(concatListLine).join('\n') + '\n');

  const signatures = segments.map((segment) => streamSignature(tools.ffprobe, segment));
  const sameSignature = signatures.every((sig) => JSON.stringify(sig) === JSON.stringify(signatures[0]));

  if (sameSignature) {
    // concat デムクサは各セグメント mp4 の edit list（AAC プライミング除去）を無視するため、
    // 音声を通すとセグメントごとに約46msの遅れが入り、-c copy では累積までする。
    // 映像のみデムクサで copy し、音声は個別入力から concat フィルタで結合する。
    // 各音声はデムクサの前進量（コンテナ duration）ちょうどに切り詰め/無音パディングして
    // 映像タイムラインと厳密に揃える。
    const inputs = segments.flatMap((segment) => ['-i', segment]);
    const pads = segments.map((segment, i) => {
      const slot = probeDuration(tools.ffprobe, segment).toFixed(6);
      return `[${i + 1}:a]aresample=44100,atrim=0:${slot},apad=whole_dur=${slot}[a${i}]`;
    });
    const refs = segments.map((_, i) => `[a${i}]`).join('');
    const filter = [...pads, `${refs}concat=n=${segments.length}:v=0:a=1[a]`].join(';');
    execFileSync(tools.ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      ...inputs,
      '-filter_complex', filter,
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      outPath,
    ], { stdio: 'inherit' });
    return { method: 'concat-vcopy', outPath };
  }

  console.warn('⚠️ セグメントのストリーム署名が揃っていないため concat filter にフォールバックします。');
  concatFilter({ tools, segments, outPath, config });
  return { method: 'concat-filter', outPath };
}

function concatFilter({ tools, segments, outPath, config }) {
  const inputs = segments.flatMap((segment) => ['-i', segment]);
  // 音声長が映像長と一致しないセグメントがあると concat filter でも音ズレが
  // 蓄積するため、各音声をセグメントの映像長ちょうどに切り詰め/無音パディングする。
  const pads = segments.map((segment, i) => {
    const duration = probeVideoDuration(tools.ffprobe, segment);
    return `[${i}:a]atrim=0:${duration},apad=whole_dur=${duration}[a${i}]`;
  });
  const refs = segments.map((_, i) => `[${i}:v][a${i}]`).join('');
  const filter = [...pads, `${refs}concat=n=${segments.length}:v=1:a=1[v][a]`].join(';');
  execFileSync(tools.ffmpeg, [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '[a]',
    ...encodeArgs(config),
    '-movflags', '+faststart',
    outPath,
  ], { stdio: 'inherit' });
}

function probeVideoDuration(ffprobe, filePath) {
  const raw = execFileSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=start_time,duration',
    '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf8' });
  const [start, duration] = raw.trim().split(',').map(Number);
  return Math.max(0.04, (Number.isFinite(start) && start > 0 ? start : 0) + (duration || 0)).toFixed(3);
}

export function streamSignature(ffprobe, filePath) {
  const raw = execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels,channel_layout',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8' });
  const json = JSON.parse(raw);
  return (json.streams || []).map((stream) => {
    if (stream.codec_type === 'video') {
      return {
        type: 'video',
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
        pix_fmt: stream.pix_fmt,
        r_frame_rate: stream.r_frame_rate,
      };
    }
    if (stream.codec_type === 'audio') {
      return {
        type: 'audio',
        codec: stream.codec_name,
        sample_rate: stream.sample_rate,
        channels: stream.channels,
      };
    }
    return { type: stream.codec_type, codec: stream.codec_name };
  });
}

export function mixBgm({ tools, inputPath, outPath, config }) {
  if (!config.bgm.enabled) return { mixed: false, outPath: inputPath };

  const bgmPath = optionalAsset(config.bgm.file, 'BGM');
  if (!bgmPath) return { mixed: false, outPath: inputPath };

  const duration = probeDuration(tools.ffprobe, inputPath);
  const [fadeIn, fadeOut] = Array.isArray(config.bgm.fade) ? config.bgm.fade : [0, 0];
  const filters = [`volume=${Number(config.bgm.volume) || 0.15}`];
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0 && duration > fadeOut) filters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`);

  execFileSync(tools.ffmpeg, [
    '-y',
    '-i', inputPath,
    '-stream_loop', '-1',
    '-i', bgmPath,
    '-filter_complex', `[1:a]${filters.join(',')}[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ], { stdio: 'inherit' });
  return { mixed: true, outPath };
}

export function probeDuration(ffprobe, filePath) {
  const raw = execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8' });
  return Number(raw.trim()) || 0;
}

export function subtitlesFilter(assPath, fontsDir) {
  return `subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(fontsDir)}'`;
}
