import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolveFfmpeg } from '../create-video/ffmpeg.js';

/** 外部コマンドを実行し、失敗時は理由を示す。 */
export function run(bin, args, options = {}) {
  const r = spawnSync(bin, args.map(String), { maxBuffer: 256 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) {
    throw new Error(
      `${bin} が失敗しました: ${
        r.error?.message ||
        String(r.stderr || '')
          .trim()
          .slice(-2500) ||
        `終了コード ${r.status}`
      }`,
    );
  }
  return r.stdout;
}

/**
 * 生成に必要な外部ツールを確認する。
 * FFMPEG_BIN を指定したらそれをそのまま使う（無ければ止まる）。指定が無ければ createVideo と同じ選び方
 * （ffmpeg-full → PATH）。ffmpeg-full なら drawtext でスペクトログラムに文字を描ける。
 */
export function resolveTools() {
  let ffmpeg = process.env.FFMPEG_BIN;
  let ffprobe;
  if (!ffmpeg) {
    try {
      ({ffmpeg, ffprobe} = resolveFfmpeg());
    } catch {
      ffmpeg = 'ffmpeg';
    }
  }
  ffprobe ||=
    process.env.FFPROBE_BIN ||
    (ffmpeg.includes('/') ? ffmpeg.replace(/ffmpeg$/, 'ffprobe') : 'ffprobe');
  for (const [bin, args] of [
    [ffmpeg, ['-version']],
    [ffprobe, ['-version']],
    ['rubberband', ['--version']],
    ['xmllint', ['--version']],
  ]) {
    run(bin, args);
  }
  const filters = String(run(ffmpeg, ['-hide_banner', '-filters']));
  return {ffmpeg, ffprobe, rubberband: 'rubberband', drawtext: /\sdrawtext\s/.test(filters)};
}

/** 音声を指定の標本化周波数で読み込む。開始・長さは入力基準の秒。 */
export function decode(file, tools, sr = 48000, channels = 1, start, duration) {
  const args = ['-v', 'error'];
  if (start !== undefined) {
    args.push('-ss', start);
  }
  args.push('-i', file);
  if (duration !== undefined) {
    args.push('-t', duration);
  }
  args.push('-vn', '-ac', channels, '-ar', sr, '-f', 'f32le', '-');
  const b = run(tools.ffmpeg, args);
  const out = new Float32Array(b.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = b.readFloatLE(i * 4);
  }
  return out;
}

/** 音声を 16 ビット PCM の WAV バッファにする。 */
export function wavBuffer(x, sr = 48000, channels = 1) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  }
  return b;
}

/** 音声を WAV ファイルへ保存する。 */
export const writeWav = (file, x, sr = 48000, channels = 1) =>
  fs.writeFileSync(file, wavBuffer(x, sr, channels));

/** 音声の実効値を求める。 */
export const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));

/** 数値の中央値を求め、空なら null を返す。 */
export function median(x) {
  if (!x.length) {
    return null;
  }
  const a = [...x].sort((a, b) => a - b);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 音声の両端へミリ秒指定のフェードをかける。 */
export function fade(x, sr, msIn = 3, msOut = 20) {
  const y = Float32Array.from(x);
  const ni = Math.min(y.length, Math.round((sr * msIn) / 1000));
  const no = Math.min(y.length, Math.round((sr * msOut) / 1000));
  for (let i = 0; i < ni; i++) {
    y[i] *= i / Math.max(1, ni - 1);
  }
  for (let i = 0; i < no; i++) {
    y[y.length - 1 - i] *= i / Math.max(1, no - 1);
  }
  return y;
}

/** 音節の無音を除き、音量と両端を整える。 */
export function cleanUnit(x, sr) {
  let a = 0;
  let b = x.length;
  while (a < b && Math.abs(x[a]) < 0.01) {
    a++;
  }
  while (b > a && Math.abs(x[b - 1]) < 0.01) {
    b--;
  }
  const y = x.slice(a, b);
  const gain = Math.min(20, 0.1 / (rms(y) || 1));
  return fade(
    y.map((v) => v * gain),
    sr,
    3,
    15,
  );
}
// 試作と同じ YIN の差分・累積平均正規化・放物線補間。解析は 44.1kHz。

/** 44.1kHz を既定としてフレームごとの音高と音量を解析する。 */
export function yin(x, sr = 44100, { n = 2048, hop = 256, threshold = 0.2 } = {}) {
  const out = [];
  const tmax = Math.floor(sr / 110);
  const tmin = Math.floor(sr / 900);
  const w = n / 2;
  const d = new Float64Array(tmax + 1);
  const cm = new Float64Array(tmax + 1);
  const count = Math.max(0, Math.floor((x.length - n) / hop));
  for (let frame = 0; frame < count; frame++) {
    const pos = frame * hop;
    const values = x.subarray(pos, pos + n);
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const level = Math.sqrt(Math.max(0, rms(values) ** 2 - mean ** 2));
    let f0 = 0;
    if (level >= 0.01) {
      let sum = 0;
      for (let t = 1; t <= tmax; t++) {
        let diff = 0;
        for (let j = 0; j < w; j++) {
          const v = x[pos + j] - x[pos + j + t];
          diff += v * v;
        }
        d[t] = diff;
        sum += diff;
        cm[t] = (diff * t) / Math.max(sum, 1e-12);
      }
      cm[0] = 1;
      let t = tmin;
      while (t < tmax && cm[t] >= threshold) {
        t++;
      }
      if (t < tmax) {
        while (t + 1 < tmax && cm[t + 1] < cm[t]) {
          t++;
        }
        const den = cm[t - 1] - 2 * cm[t] + cm[t + 1];
        const refined = t + (den ? (0.5 * (cm[t - 1] - cm[t + 1])) / den : 0);
        f0 = sr / refined;
      }
    }
    out.push({ time: (pos + n / 2) / sr, f0, db: 20 * Math.log10(level + 1e-9) });
  }
  return out;
}

/** 音声の音高中央値と半音単位のばらつきを求める。 */
export function measure(x, sr = 44100) {
  const frames = yin(x, sr);
  const ms = frames.filter((f) => f.f0 > 0).map((f) => 69 + 12 * Math.log2(f.f0 / 440));
  const mean = ms.reduce((a, b) => a + b, 0) / (ms.length || 1);
  return {
    midi: ms.length >= 2 ? median(ms) : null,
    f0Std: ms.length ? Math.sqrt(ms.reduce((s, v) => s + (v - mean) ** 2, 0) / ms.length) : null,
    frames,
  };
}
// 戻り値は「高画質内の時刻 = 低画質内の時刻 + offsetSec」。正規化相互相関。

/** 低画質の時刻へ足す高画質の時間差を秒で求める。 */
export function correlate(reference, target, sr, maxSec = 0.25) {
  const max = Math.round(sr * maxSec);
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = -max; lag <= max; lag++) {
    const a = Math.max(0, -lag);
    const b = Math.min(reference.length, target.length - lag);
    let xy = 0;
    let xx = 0;
    let yy = 0;
    let sx = 0;
    let sy = 0;
    for (let i = a; i < b; i++) {
      const x = reference[i];
      const y = target[i + lag];
      xy += x * y;
      xx += x * x;
      yy += y * y;
      sx += x;
      sy += y;
    }
    const n = b - a;
    const score =
      n > sr * 0.1
        ? (xy - (sx * sy) / n) /
          Math.max(
            1e-12,
            Math.sqrt(Math.max(0, xx - (sx * sx) / n) * Math.max(0, yy - (sy * sy) / n)),
          )
        : -1;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return { offsetSec: bestLag / sr, correlation: best };
}

/** タイムライン秒をフレーム位置と先頭無音のサンプル数に分ける。 */
export function framePadding(onsetSec, fps, sr) {
  const onsetSample = Math.round(onsetSec * sr);
  let frame = Math.floor((onsetSample * fps) / sr);
  while (Math.round((frame * sr) / fps) > onsetSample) {
    frame--;
  }
  const frameSample = Math.round((frame * sr) / fps);
  return { frame, onsetSample, frameSample, silenceSamples: onsetSample - frameSample };
}

/** 音声を指定のサンプル位置へ加算する。 */
export function place(buf, x, sample, gain = 1) {
  for (let i = Math.max(0, -sample); i < x.length && sample + i < buf.length; i++) {
    buf[sample + i] += x[i] * gain;
  }
}

/** ピークを制限し、音声と適用ゲインを返す。 */
export function limit(x, peak = 0.95) {
  let max = 0;
  for (const v of x) {
    max = Math.max(max, Math.abs(v));
  }
  const gain = max > peak ? peak / max : 1;
  return { audio: x.map((v) => v * gain), gain };
}
