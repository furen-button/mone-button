#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEFAULTS, parseArgs, projectRoot } from './config.js';
import { readAllClips } from './select.js';
import { resolveClipSource } from './clip.js';
import { resolveFfmpeg, probeVideoStream } from './ffmpeg.js';
import { planCamera, cameraFilters } from './camera-render.js';
import { planEnhance } from './enhance.js';
import { CAMERA_ASPECTS, aspectKey } from './camera.js';

export async function exportCrop(opts) {
  const aspect = opts.aspect || '9:16';
  const scaler = opts.scaler || 'anime4k';
  const dimensions = opts.size || { '9:16': '1080x1920', '16:9': '1920x1080', '1:1': '1080x1080' }[aspect];
  if (!CAMERA_ASPECTS.includes(aspect) || !['anime4k', 'lanczos'].includes(scaler) || !/^\d+x\d+$/u.test(dimensions)) {
    throw new Error('aspect / size / scaler が不正です。');
  }
  const [width, height] = dimensions.split('x').map(Number);
  if (width < 2 || height < 2 || width > 7680 || height > 7680 || width % 2 || height % 2) {
    throw new Error('size は 2〜7680 の偶数で指定してください。');
  }
  if (aspectKey({ width, height }) !== aspect) {
    throw new Error('size の縦横比が aspect と一致しません。');
  }
  const tools = resolveFfmpeg();
  const clip = opts.clip ? readAllClips().find((entry) => entry.base === opts.clip) : null;
  if (opts.clip && !clip) {
    throw new Error('クリップが見つかりません。');
  }
  const input = opts.input || (clip && resolveClipSource(clip, { source: 'cache' }, { allowDownload: false }));
  if (!input || !fs.existsSync(input)) {
    throw new Error('入力動画が見つかりません。');
  }
  const camera = opts.camera ? JSON.parse(fs.readFileSync(opts.camera, 'utf8')) : clip?.data?.effects?.camera?.[aspect];
  const probe = probeVideoStream(tools.ffprobe, input);
  const size = { width, height, fps: probe.fps };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-'));
  const out = path.resolve(opts.out || path.join(projectRoot, 'output/crop', `${path.basename(input, path.extname(input))}-${aspect.replace(':', 'x')}.mp4`));
  try {
    const config = { ...DEFAULTS, effects: { ...DEFAULTS.effects,
      enhance: { ...DEFAULTS.effects.enhance, enabled: scaler === 'anime4k', minSourceHeight: 1 } } };
    const plan = await planCamera({ tools, clip: { data: { effects: { camera: { [aspect]: camera } } } }, sourceMp4: input, config, size, workDir, probe });
    if (!plan) {
      throw new Error('この縦横比のキーフレームがありません。');
    }
    const enhance = await planEnhance({ tools, clip: { data: { effects: { enhance: scaler === 'anime4k' ? {} : false } } }, sourceMp4: input, config, probe });
    if (path.resolve(input) === out) {
      throw new Error('入力と出力は別のファイルにしてください。');
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await new Promise((resolve, reject) => {
      const proc = spawn(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
        '-vf', cameraFilters(plan, size, { enhance }), '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
        '-nostats', '-progress', 'pipe:1', out], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buffer = '';
      let last = -1;
      proc.stdout.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const match = /^out_time_us=(\d+)/u.exec(line);
          const pct = match ? Math.min(100, Math.floor(Number(match[1]) / 1e6 / probe.duration * 100)) : -1;
          if (pct >= last + 2) {
            console.log(`🎬 [${pct}/100] 描画中: ${path.basename(out)}`);
            last = pct;
          }
        }
      });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg 終了コード ${code}`)));
    });
    console.log(`🎬 [100/100] 描画中: ${path.basename(out)}`);
    console.log(`✅ 完成: ${out}`);
    return out;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportCrop(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
