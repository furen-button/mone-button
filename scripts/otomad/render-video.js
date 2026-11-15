import fs from 'node:fs';
import path from 'node:path';
import { run } from './audio.js';

/** 動画のフレーム数・fps・音声の有無を調べる。 */
export function probe(file, tools) {
  const j = JSON.parse(
    run(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]),
  );
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [num, den] = String(v?.r_frame_rate || '0/1')
    .split('/')
    .map(Number);
  return {
    duration: Number(v?.duration || j.format.duration),
    frames: Number(v?.nb_frames),
    width: v?.width,
    height: v?.height,
    fps: num / den,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

/** 出力サイズと映像効果を適用するフィルターを作る。 */
export function videoFilter(p, fx = { zoom: 1, hflip: false }) {
  const { width: w, height: h, fps } = p.output;
  const zoom = fx.zoom || 1;
  const zw = Math.ceil((w * zoom) / 2) * 2;
  const zh = Math.ceil((h * zoom) / 2) * 2;
  return [
    `fps=${fps}`,
    `scale=${zw}:${zh}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    'setsar=1',
    ...(fx.hflip ? ['hflip'] : []),
  ].join(',');
}

/** 出力 fps に合わせた動画エンコード引数を作る。 */
export const encodeVideo = (p) => [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-r',
  p.output.fps,
  '-video_track_timescale',
  p.output.fps * 1000,
];

/** タイムラインのフレーム境界に合わせてカットと試聴映像を作る。 */
export function renderVideo(p, score, out, tools, log = console.log) {
  fs.mkdirSync(path.join(out, 'video/cut'), { recursive: true });
  const parts = [];
  const meta = {};
  const work = path.join(out, '.work');
  const fps = p.output.fps;
  function black(frames, name) {
    if (frames <= 0) {
      return;
    }
    const f = path.join(work, name + '.mp4');
    run(tools.ffmpeg, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${p.output.width}x${p.output.height}:r=${fps}`,
      '-frames:v',
      frames,
      ...encodeVideo(p),
      '-an',
      f,
    ]);
    parts.push(f);
  }
  black(score[0]?.videoStartFrame || 0, 'intro');
  for (const e of score) {
    const file = path.join(out, e.sampleFile);
    meta[e.base] ||= probe(file, tools);
    e.sourceInfo = meta[e.base];
    if (e.videoFrames <= 0) {
      continue;
    }
    const sec = e.videoFrames / fps;
    const info = meta[e.base];
    const start = Math.min(e.hqSourceStart, Math.max(0, info.duration - 1 / (info.fps || fps)));
    e.videoSourceStart = start;
    log(`映像を書き出し ${e.id}/${score.length}: ${e.kana}（${e.videoFrames} フレーム）`);
    const cut = path.join(out, e.videoFile);
    const args = ['-y', '-v', 'error', '-ss', start, '-i', file];
    if (!info.hasAudio) {
      args.push('-f', 'lavfi', '-i', `anullsrc=r=${p.output.sampleRate}:cl=stereo`);
    }
    args.push(
      '-map',
      '0:v:0',
      '-map',
      info.hasAudio ? '0:a:0' : '1:a:0',
      '-vf',
      `${videoFilter(p)},tpad=stop_mode=clone:stop_duration=${sec}`,
      '-af',
      `apad=whole_dur=${sec},atrim=duration=${sec}`,
      '-frames:v',
      e.videoFrames,
      '-t',
      sec,
      ...encodeVideo(p),
      '-c:a',
      'aac',
      '-ar',
      p.output.sampleRate,
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      cut,
    );
    run(tools.ffmpeg, args);
    if (probe(cut, tools).frames !== e.videoFrames) {
      throw new Error(`カットのフレーム数が一致しません: ${e.id}`);
    }
    const effected = path.join(work, `fx-${e.id}.mp4`);
    run(tools.ffmpeg, [
      '-y',
      '-v',
      'error',
      '-i',
      cut,
      '-vf',
      videoFilter(p, e.fx),
      '-frames:v',
      e.videoFrames,
      ...encodeVideo(p),
      '-an',
      effected,
    ]);
    if (probe(effected, tools).frames !== e.videoFrames) {
      throw new Error(`効果映像のフレーム数が一致しません: ${e.id}`);
    }
    parts.push(effected);
  }
  const list = path.join(work, 'preview.txt');
  fs.writeFileSync(
    list,
    parts.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join('\n') + '\n',
  );
  // MP4 の duration はミリ秒へ丸められる。concat の PTS をそのまま使わず、
  // 連番フレームから再構成してカット数による時刻の累積ずれを防ぐ。
  // 色メタデータの違いでフィルターが再初期化されると N が戻るため無効にする。
  run(tools.ffmpeg, [
    '-y',
    '-v',
    'error',
    '-reinit_filter',
    '0',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-i',
    path.join(out, 'audio/mix.wav'),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    `setpts=N/${fps}/TB`,
    ...encodeVideo(p),
    '-c:a',
    'aac',
    '-ar',
    p.output.sampleRate,
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    path.join(out, 'video/preview.mp4'),
  ]);
  if (probe(path.join(out, 'video/preview.mp4'), tools).frames !== score.at(-1).videoEndFrame) {
    throw new Error('通し映像の合計フレーム数が一致しません');
  }
  return meta;
}
