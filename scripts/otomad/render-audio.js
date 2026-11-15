import fs from 'node:fs';
import path from 'node:path';
import { run, decode, writeWav, fade, place, limit } from './audio.js';
import { root, timelineStart, timelineDuration } from './project.js';

/** タイムラインのサンプル位置へ声と曲を配置して書き出す。 */
export function renderAudio(p, score, out, tools, log = console.log) {
  const sr = p.output.sampleRate;
  const n = Math.round(timelineDuration(p) * sr);
  const voice = new Float32Array(n);
  const work = path.join(out, '.work');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(out, 'audio/events'), { recursive: true });
  const decoded = new Map();
  for (const e of score) {
    log(`声を書き出し ${e.id}/${score.length}: ${e.kana} → ${e.pitch || '原音'}`);
    // 高画質があれば samples の clip.mp4（高画質を揃えたもの）の音声を時間差つきで使う。無ければ public/videos。
    const source = e.lowQuality
      ? path.join(root, 'public/videos', e.base + '.mp4')
      : path.join(out, e.sampleFile);
    if (!decoded.has(e.base)) {
      decoded.set(e.base, decode(source, tools, sr));
    }
    const x = decoded
      .get(e.base)
      .slice(
        Math.max(0, Math.floor((e.sourceStart + e.audioOffsetSec) * sr)),
        Math.max(0, Math.floor((e.sourceEnd + e.audioOffsetSec) * sr)),
      );
    let y;
    if (e.kind === 'accent') {
      y = fade(x, sr, 4, 12).map((v) => v * 1.2);
    } else {
      const src = path.join(work, 'source.wav');
      const dst = path.join(work, 'shifted.wav');
      writeWav(src, fade(x, sr, 4, 12), sr);
      run(tools.rubberband, [
        '-q',
        '-3',
        '-F',
        '-p',
        e.semis.toFixed(3),
        '-t',
        e.stretch.toFixed(3),
        src,
        dst,
      ]);
      y = fade(decode(dst, tools, sr).slice(0, Math.floor(e.targetSec * sr)), sr, 3, 20);
    }
    const padded = new Float32Array(e.padding.silenceSamples + y.length);
    padded.set(y, e.padding.silenceSamples);
    e.audioSamples = padded.length;
    e.audioFrames = Math.ceil((padded.length / sr) * p.output.fps);
    writeWav(path.join(out, e.audioFile), padded, sr);
    place(voice, y, e.padding.onsetSample);
  }
  // イベントとミックスのゲインを同じにし、XML の A2+A3 と A4 が一致するようにする。
  const limited = limit(voice);
  if (limited.gain < 1) {
    for (const e of score) {
      const file = path.join(out, e.audioFile);
      const audio = decode(file, tools, sr);
      writeWav(
        file,
        audio.map((v) => v * limited.gain),
        sr,
      );
    }
  }
  const v = limited.audio;
  writeWav(path.join(out, 'audio/voice-mix.wav'), v, sr);
  const track = decode(path.resolve(root, p.audio), tools, sr, 2, timelineStart(p), n / sr);
  const backing = new Float32Array(n * 2);
  backing.set(track.subarray(0, backing.length));
  writeWav(path.join(out, 'audio/backing.wav'), backing, sr, 2);
  const mix = backing.map((x, i) => x * p.output.trackGain + v[Math.floor(i / 2)]);
  const final = limit(mix);
  writeWav(path.join(out, 'audio/mix.wav'), final.audio, sr, 2);
  return { voiceGain: limited.gain, mixGain: final.gain };
}

/** タイムライン基準でクリックと旋律ガイドを生成する。 */
export function renderGuides(p, melody, beats, out) {
  const sr = p.output.sampleRate;
  const n = Math.round(timelineDuration(p) * sr);
  const click = new Float32Array(n);
  const guide = new Float32Array(n);
  for (const b of beats) {
    const x = Float32Array.from(
      { length: Math.round(sr * 0.03) },
      (_, i) =>
        Math.sin((2 * Math.PI * (b.beatInBar === 0 ? 1500 : 1000) * i) / sr) *
        Math.exp((-i / sr) * 120) *
        (b.beatInBar === 0 ? 0.5 : 0.3),
    );
    place(click, x, Math.round(b.timelineSec * sr));
  }
  for (const m of melody) {
    const d = ((Math.min(m.len, 1) * 60) / p.beat.bpm) * 0.9;
    const f = 440 * 2 ** ((m.midi - 69) / 12);
    const x = Float32Array.from(
      { length: Math.round(d * sr) },
      (_, i) => 0.25 * Math.sin((2 * Math.PI * f * i) / sr),
    );
    const t = p.beat.offsetSec + (m.beat * 60) / p.beat.bpm - timelineStart(p);
    place(guide, fade(x, sr, 3, 15), Math.round(t * sr));
  }
  writeWav(path.join(out, 'beats/click.wav'), click, sr);
  writeWav(path.join(out, 'melody/guide.wav'), guide, sr);
}
