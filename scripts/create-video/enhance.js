import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { cacheRoot } from './assets.js';
import { escapeFilterPath } from './ass.js';
import { resolveProjectPath } from './config.js';
import { ffmpegLibplaceboStatus, probeVideoStream } from './ffmpeg.js';

// アニメ向け線補正（effects.enhance）。Anime4K の GLSL シェーダを ffmpeg の libplacebo フィルタで掛ける。
// ソースを差し替えるのではなくレンダーのフィルタ列に組み込むので、キャッシュ・中間ファイル・追加バイナリは無い。
export const anime4kRoot = path.join(cacheRoot, 'tools', 'anime4k');
export const anime4kZipUrl = 'https://github.com/bloc97/Anime4K/releases/download/v4.0.1/Anime4K_v4.0.zip';
const shaderPrefix = 'Anime4K_';
const presetsDirName = '.presets';
const warned = new Set();

// 設定・CLI・クリップ JSON だけで決まる部分。ffprobe や libplacebo の確認より前に抜けるので既定 OFF はコスト 0。
// null=対象外 / {skip}=設定はあるが抑止 / {forced, override}=実行候補（zoom / avoidFace と同じ順序）
export function enhanceRequested(config, clip) {
  const setting = config.effects?.enhance;
  const override = clip?.data?.effects?.enhance;
  const hasOverride = override !== undefined;
  if (config.__meta?.cli?.enhance === false) {
    return hasOverride ? { skip: '--no-enhance 指定' } : null;
  }
  if (!setting?.enabled && !hasOverride) {
    return null;
  }
  if (override === false) {
    return { skip: '手動OFF' };
  }
  return { forced: hasOverride, override: isPlainObject(override) ? override : {} };
}

// 補正の計画。null=対象外 / {applied:false, reason} / {applied:false, fallback:true, reason} / {applied:true, ...}。
// probe / status はテストから ffprobe と libplacebo 確認を差し替えるための注入口。
export async function planEnhance({ tools, clip, sourceMp4, config, probe = null, status = null }) {
  const request = enhanceRequested(config, clip);
  if (!request) {
    return null;
  }
  if (request.skip) {
    return { applied: false, reason: request.skip };
  }
  const setting = config.effects.enhance;
  const source = probe || probeVideoStream(tools.ffprobe, sourceMp4);
  const minHeight = Math.max(1, Math.round(Number(setting.minSourceHeight) || 720));
  if (!request.forced && source.height < minHeight) {
    return { applied: false, reason: `ソース ${source.height}p < ${minHeight}p` };
  }
  // クリップ JSON で null を明示したら「そのシェーダを使わない」なので ?? ではなくキーの有無で見る。
  const restore = shaderName(pick(request.override, setting, 'restore'));
  const upscale = shaderName(pick(request.override, setting, 'upscale'));
  if (!restore && !upscale) {
    return { applied: false, reason: 'restore / upscale とも未指定' };
  }
  const libplacebo = status || ffmpegLibplaceboStatus(tools.ffmpeg);
  if (!libplacebo.ok) {
    return fallback(setting, 'libplacebo', `libplacebo が使えません（brew install molten-vk）: ${libplacebo.reason}`);
  }
  try {
    const shadersDir = await ensureAnime4kShaders(setting.shadersDir);
    const presetsDir = path.join(shadersDir, presetsDirName);
    const clamp = setting.clampHighlights === false ? [] : ['Clamp_Highlights'];
    return {
      applied: true,
      backend: 'anime4k',
      restore,
      upscale,
      restorePreset: restore ? buildPreset({ names: [...clamp, restore], shadersDir, presetsDir }) : null,
      upscalePreset: upscale ? buildPreset({ names: [...clamp, upscale], shadersDir, presetsDir }) : null,
      from: { w: source.width, h: source.height },
    };
  } catch (err) {
    return fallback(setting, 'shaders', err.message);
  }
}

// 等倍の線復元。scale+pad+fps の後（ズームの切り出しやテロップより前）に置く。
// dithering=none で 8bit への戻しを決定的にする。colorspace / range は auto でフレームのタグ（bt709 / tv）を踏襲する。
export function restoreFilter(plan) {
  return `libplacebo=custom_shader_path='${escapeFilterPath(plan.restorePreset)}':format=yuv420p:dithering=none`;
}

// ズームの切り出し後の拡大。Anime4K の Upscale は出力が入力の 1.2 倍超のとき（//!WHEN）に CNN x2 が走り、
// 余った分は libplacebo の downscaler で目的サイズへ戻る。
export function upscaleFilter(plan, size) {
  return [
    `libplacebo=w=${size.width}:h=${size.height}`,
    `custom_shader_path='${escapeFilterPath(plan.upscalePreset)}'`,
    'upscaler=ewa_lanczossharp',
    'format=yuv420p',
    'dithering=none',
  ].join(':');
}

export function formatEnhanceLog(plan) {
  if (!plan) {
    return null;
  }
  if (!plan.applied) {
    return `   ✨ 補正: なし (${plan.reason})`;
  }
  const parts = [];
  if (plan.restore) {
    parts.push(`復元 ${plan.restore}`);
  }
  if (plan.upscale) {
    parts.push(`zoom 拡大 ${plan.upscale}`);
  }
  return `   ✨ 補正: ${parts.join(' / ')} (ソース ${plan.from.w}x${plan.from.h})`;
}

// 設定値をシェーダ名に正規化する。null / 空なら null。'Anime4K_' 接頭辞や '.glsl' が付いていても受ける。
export function shaderName(value) {
  if (value === null || value === undefined || value === false) {
    return null;
  }
  let name = String(value).trim();
  if (name.startsWith(shaderPrefix)) {
    name = name.slice(shaderPrefix.length);
  }
  if (name.endsWith('.glsl')) {
    name = name.slice(0, -'.glsl'.length);
  }
  return name || null;
}

// names（例 ['Clamp_Highlights', 'Restore_CNN_M']）を順に連結した 1 ファイルを作る。libplacebo の custom_shader_path は
// 1 ファイルしか受けないが、mpv .hook 形式の複数ブロックを順に読むので、連結すれば mpv の glsl-shaders リストと同じになる。
// 内容が同じなら書き直さない。名前が見つからなければ throw（呼び元でフォールバック）。
export function buildPreset({ names, shadersDir, presetsDir }) {
  const files = names.map((name) => findShader(shadersDir, name));
  const body = `${files.map((file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd()).join('\n\n')}\n`;
  const presetPath = path.join(presetsDir, `${names.join('+')}.glsl`);
  if (!fs.existsSync(presetPath) || fs.readFileSync(presetPath, 'utf8') !== body) {
    fs.mkdirSync(presetsDir, { recursive: true });
    fs.writeFileSync(presetPath, body);
  }
  return presetPath;
}

// Anime4K_*.glsl の置き場。既定は cache/createVideo/tools/anime4k/glsl で、無ければ release zip を取得して展開する。
// shadersDir を明示した場合は取得せず、無ければ throw（→ フォールバック）。
export async function ensureAnime4kShaders(configuredDir) {
  const dir = configuredDir ? resolveProjectPath(configuredDir) : path.join(anime4kRoot, 'glsl');
  if (hasShaders(dir)) {
    return dir;
  }
  if (configuredDir) {
    throw new Error(`${shaderPrefix}*.glsl が見つかりません: ${dir}`);
  }
  console.log(`⬇️ Anime4K シェーダを取得中: ${anime4kZipUrl}`);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(anime4kRoot, path.basename(new URL(anime4kZipUrl).pathname));
  const response = await fetch(anime4kZipUrl);
  if (!response.ok) {
    throw new Error(`シェーダ zip を取得できません: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('シェーダ zip を取得できません: empty response');
  }
  fs.writeFileSync(zipPath, bytes);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir], { stdio: 'ignore' });
  if (!hasShaders(dir)) {
    throw new Error(`zip に ${shaderPrefix}*.glsl が含まれていません: ${zipPath}`);
  }
  return dir;
}

function hasShaders(dir) {
  return fs.existsSync(dir) && listShaders(dir).length > 0;
}

// 再帰的に Anime4K_*.glsl を集める（zip がサブディレクトリ構成でも拾う）。生成したプリセットは接頭辞が違うので混ざらない。
function listShaders(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .map(String)
    .filter((rel) => path.basename(rel).startsWith(shaderPrefix) && rel.endsWith('.glsl'))
    .map((rel) => path.join(dir, rel));
}

function findShader(shadersDir, name) {
  const fileName = `${shaderPrefix}${name}.glsl`;
  const found = listShaders(shadersDir).find((file) => path.basename(file) === fileName);
  if (!found) {
    throw new Error(`シェーダが見つかりません: ${fileName}（${shadersDir}）`);
  }
  return found;
}

function fallback(setting, kind, reason) {
  if (setting.required) {
    throw new Error(`補正が必須（effects.enhance.required）ですが実行できません: ${reason}`);
  }
  if (!warned.has(kind)) {
    warned.add(kind);
    console.warn(`⚠️ 補正（Anime4K）をスキップします: ${reason}`);
  }
  return { applied: false, fallback: true, reason };
}

function pick(override, setting, key) {
  return key in override ? override[key] : setting[key];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
