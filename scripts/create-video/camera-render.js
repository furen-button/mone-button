import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { aspectKey, normalizeCamera, cameraExprAst, exprToString, cameraRectAt } from './camera.js';
import { ffmpegLibplaceboStatus, probeVideoStream, probeDuration } from './ffmpeg.js';
import { restoreFilter } from './enhance.js';
import { escapeFilterPath } from './ass.js';

export async function planCamera({ tools, clip, sourceMp4, config, size, workDir, probe = null, status = null }) {
  const aspect = aspectKey(size);
  const value = clip.data?.effects?.camera?.[aspect];
  if (config.effects?.camera?.enabled === false || !value) {
    return null;
  }
  const normalized = normalizeCamera(value);
  if (normalized.error) {
    console.warn(`⚠️ camera を無視します: ${normalized.error}`);
    return null;
  }
  const source = probe || probeVideoStream(tools.ffprobe, sourceMp4);
  const available = status || ffmpegLibplaceboStatus(tools.ffmpeg);
  const plan = { applied: true, aspect, keyframes: normalized.keyframes,
    from: { width: source.width, height: source.height }, backend: available.ok ? 'libplacebo' : 'sendcmd', fallback: !available.ok };
  if (!(source.width > 0 && source.height > 0)) {
    throw new Error('camera の元映像サイズを取得できません。');
  }
  if (!available.ok) {
    console.warn(`⚠️ camera_fallback: ${available.reason}`);
    const fps = size.fps || source.fps || 30;
    const duration = source.duration || probeDuration(tools.ffprobe, sourceMp4);
    fs.mkdirSync(workDir, { recursive: true });
    plan.commands = path.join(workDir, `camera-${crypto.createHash('sha1').update(JSON.stringify([sourceMp4, size, plan.keyframes])).digest('hex')}.cmd`);
    const lines = [];
    for (let i = 0; i <= Math.ceil(duration * fps); i += 1) {
      const rect = integerCameraRect(cameraRectAt(plan.keyframes, i / fps, plan.from, aspect));
      lines.push(`${(i / fps).toFixed(9)} crop w ${rect.w}, crop h ${rect.h}, crop x ${rect.x}, crop y ${rect.y};`);
    }
    fs.writeFileSync(plan.commands, lines.join('\n'));
  }
  return plan;
}

export function integerCameraRect(rect) {
  return Object.fromEntries(Object.entries(rect).map(([key, value]) => [key,
    key === 'w' || key === 'h' ? Math.max(2, Math.floor(value / 2) * 2) : Math.max(0, Math.floor(value / 2) * 2)]));
}

export function staticCameraFilter(rect, size) {
  const { x, y, w, h } = integerCameraRect(rect);
  return `crop=${w}:${h}:${x}:${y},scale=${size.width}:${size.height}:flags=lanczos,setsar=1`;
}

export function cameraFilters(plan, size, { enhance = null, rect = null } = {}) {
  const prefix = [
    // SAR を寸法へ織り込み、以後の枠をブラウザの表示座標と揃える。
    `scale=${plan.from.width}:${plan.from.height}`, 'setsar=1',
    ...(size.fps ? [`fps=${size.fps}`] : []),
  ];
  if (plan.backend !== 'libplacebo') {
    const first = integerCameraRect(rect || cameraRectAt(plan.keyframes, 0, plan.from, plan.aspect));
    return [...prefix, ...(rect ? [] : [`sendcmd=f='${escapeFilterPath(plan.commands)}'`]),
      `crop=${first.w}:${first.h}:${first.x}:${first.y}`, `scale=${size.width}:${size.height}:flags=lanczos`, 'setsar=1'].join(',');
  }
  const ast = rect || cameraExprAst(plan.keyframes, plan.from, plan.aspect);
  const crop = ['x', 'y', 'w', 'h'].map((key) => `crop_${key}='${exprToString(ast[key])}'`);
  return [...prefix,
    ...(enhance?.applied && enhance.restorePreset ? [restoreFilter(enhance)] : []),
    [`libplacebo=w=${size.width}:h=${size.height}`, ...crop,
      ...(enhance?.applied && enhance.upscalePreset ? [`custom_shader_path='${escapeFilterPath(enhance.upscalePreset)}'`] : []),
      'upscaler=ewa_lanczossharp', 'format=yuv420p', 'dithering=none'].join(':'), 'setsar=1'].join(',');
}
