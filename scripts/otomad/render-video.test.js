import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from './project.js';
import { resolveTools, run, writeWav } from './audio.js';
import { renderVideo, probe } from './render-video.js';

// ffmpeg などの外部コマンドが無い環境（CI の ubuntu）では飛ばす。
let noTools = false;
try {
  resolveTools();
} catch (error) {
  noTools = error.message;
}

test('実映像の連結: 色メタデータが違ってもプリロールを含む総フレーム数を保つ', { skip: noTools }, () => {
  const tools = resolveTools();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'otomad-video-'));
  try {
    for (const sub of ['.work', 'samples', 'audio']) {
      fs.mkdirSync(path.join(out, sub));
    }
    for (const [i, color] of ['red', 'blue'].entries()) {
      const args = [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=${color}:s=64x64:r=30`,
        '-t',
        '0.5',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
      ];
      if (i === 0) {
        args.push(
          '-color_range',
          'tv',
          '-colorspace',
          'bt709',
          '-color_primaries',
          'bt709',
          '-color_trc',
          'bt709',
        );
      }
      run(tools.ffmpeg, [...args, path.join(out, `samples/${i}.mp4`)]);
    }
    const { project: p } = loadProject();
    p.output = { ...p.output, width: 64, height: 64 };
    const score = [
      {
        id: 1,
        base: 'a',
        kana: 'あ',
        sampleFile: 'samples/0.mp4',
        hqSourceStart: 0,
        videoFile: 'video/cut/a.mp4',
        videoStartFrame: 6,
        videoEndFrame: 16,
        videoFrames: 10,
        fx: { zoom: 1.4, hflip: true },
      },
      {
        id: 2,
        base: 'b',
        kana: 'い',
        sampleFile: 'samples/1.mp4',
        hqSourceStart: 0.4,
        videoFile: 'video/cut/b.mp4',
        videoStartFrame: 16,
        videoEndFrame: 27,
        videoFrames: 11,
        fx: { zoom: 1, hflip: false },
      },
    ];
    writeWav(path.join(out, 'audio/mix.wav'), new Float32Array((27 / 60) * 48000 * 2), 48000, 2);
    renderVideo(p, score, out, tools, () => {});
    const result = probe(path.join(out, 'video/preview.mp4'), tools);
    assert.equal(result.frames, 27);
    assert.equal(result.fps, 60);
    assert.ok(Math.abs(result.duration - 27 / 60) < 1e-6);
    for (const e of score) {
      assert.equal(probe(path.join(out, e.videoFile), tools).frames, e.videoFrames);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
