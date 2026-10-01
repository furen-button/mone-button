import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULTS, deepMerge } from './config.js';
import { zoomCropFilters } from './effects.js';
import {
  buildPreset,
  enhanceRequested,
  formatEnhanceLog,
  planEnhance,
  restoreFilter,
  shaderName,
  upscaleFilter,
} from './enhance.js';

const size = { width: 1920, height: 1080, fps: 30 };
const probe1080 = { width: 1920, height: 1080, fps: 30 };
const probe144 = { width: 256, height: 144, fps: 30 };
const available = { ok: true, reason: null };
// planEnhance に probe / status を注入するので ffmpeg / ffprobe は呼ばれない。
const tools = { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' };

function makeShadersDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime4k-test-'));
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Anime4K_Clamp_Highlights.glsl'), '//!DESC clamp\n//!HOOK MAIN\n');
  fs.writeFileSync(path.join(dir, 'Anime4K_Restore_CNN_M.glsl'), '//!DESC restore\n//!HOOK MAIN\n\n');
  fs.writeFileSync(path.join(dir, 'sub', 'Anime4K_Upscale_CNN_x2_M.glsl'), '//!DESC upscale\r\n//!HOOK MAIN\r\n');
  return dir;
}

function config(enhance = {}, cli = {}) {
  return { ...deepMerge(DEFAULTS, { effects: { enhance } }), __meta: { cli } };
}

function clip(effects) {
  return { base: 'clip-a', videoId: 'abc', data: effects === undefined ? {} : { effects } };
}

describe('enhanceRequested', () => {
  it('既定 OFF ではクリップ上書きが無い限り対象外', () => {
    assert.equal(enhanceRequested(config(), clip()), null);
  });

  it('enabled なら実行候補、クリップ JSON の true は強制扱い', () => {
    assert.deepEqual(enhanceRequested(config({ enabled: true }), clip()), { forced: false, override: {} });
    assert.deepEqual(enhanceRequested(config(), clip({ enhance: true })), { forced: true, override: {} });
    assert.deepEqual(
      enhanceRequested(config(), clip({ enhance: { restore: 'Restore_CNN_Soft_M' } })),
      { forced: true, override: { restore: 'Restore_CNN_Soft_M' } },
    );
  });

  it('クリップ JSON の false は手動 OFF', () => {
    assert.deepEqual(enhanceRequested(config({ enabled: true }), clip({ enhance: false })), { skip: '手動OFF' });
  });

  it('--no-enhance は kill switch として個別指定より優先する', () => {
    assert.equal(enhanceRequested(config({ enabled: true }, { enhance: false }), clip()), null);
    assert.deepEqual(enhanceRequested(config({ enabled: true }, { enhance: false }), clip({ enhance: true })), { skip: '--no-enhance 指定' });
  });
});

describe('planEnhance', () => {
  it('既定 OFF では null（ffprobe も libplacebo 確認も呼ばない）', async () => {
    assert.equal(await planEnhance({ tools, clip: clip(), sourceMp4: '/nonexistent.mp4', config: config() }), null);
  });

  it('minSourceHeight 未満のソースは見送る（144p の existing は対象外）', async () => {
    const plan = await planEnhance({ tools, clip: clip(), sourceMp4: 'x.mp4', config: config({ enabled: true }), probe: probe144, status: available });
    assert.equal(plan.applied, false);
    assert.equal(plan.fallback, undefined);
    assert.match(plan.reason, /144p < 720p/u);
  });

  it('1080p ソースには復元・拡大のプリセットを連結して用意する', async () => {
    const shadersDir = makeShadersDir();
    const plan = await planEnhance({
      tools,
      clip: clip(),
      sourceMp4: 'x.mp4',
      config: config({ enabled: true, shadersDir }),
      probe: probe1080,
      status: available,
    });
    assert.equal(plan.applied, true);
    assert.equal(plan.backend, 'anime4k');
    assert.equal(plan.restore, 'Restore_CNN_M');
    assert.equal(plan.upscale, 'Upscale_CNN_x2_M');
    assert.deepEqual(plan.from, { w: 1920, h: 1080 });
    assert.equal(path.basename(plan.restorePreset), 'Clamp_Highlights+Restore_CNN_M.glsl');
    // Clamp_Highlights が先頭、末尾の空行は詰める
    assert.equal(fs.readFileSync(plan.restorePreset, 'utf8'), '//!DESC clamp\n//!HOOK MAIN\n\n//!DESC restore\n//!HOOK MAIN\n');
    // サブディレクトリのシェーダも拾い、CRLF は LF に揃える
    assert.equal(fs.readFileSync(plan.upscalePreset, 'utf8'), '//!DESC clamp\n//!HOOK MAIN\n\n//!DESC upscale\n//!HOOK MAIN\n');
    fs.rmSync(shadersDir, { recursive: true, force: true });
  });

  it('クリップ JSON の true は高さゲートを飛ばし、restore の上書きと clampHighlights=false を反映する', async () => {
    const shadersDir = makeShadersDir();
    fs.writeFileSync(path.join(shadersDir, 'Anime4K_Restore_CNN_Soft_M.glsl'), '//!DESC soft\n');
    const plan = await planEnhance({
      tools,
      clip: clip({ enhance: { restore: 'Anime4K_Restore_CNN_Soft_M.glsl', upscale: null } }),
      sourceMp4: 'x.mp4',
      config: config({ shadersDir, clampHighlights: false }),
      probe: probe144,
      status: available,
    });
    assert.equal(plan.applied, true);
    assert.equal(plan.restore, 'Restore_CNN_Soft_M');
    assert.equal(plan.upscale, null);
    assert.equal(plan.upscalePreset, null);
    assert.equal(path.basename(plan.restorePreset), 'Restore_CNN_Soft_M.glsl');
    fs.rmSync(shadersDir, { recursive: true, force: true });
  });

  it('libplacebo が使えなければ理由付きでフォールバック（required なら throw）', async () => {
    const broken = { ok: false, reason: 'VK_ERROR_INCOMPATIBLE_DRIVER' };
    const plan = await planEnhance({ tools, clip: clip(), sourceMp4: 'x.mp4', config: config({ enabled: true }), probe: probe1080, status: broken });
    assert.equal(plan.applied, false);
    assert.equal(plan.fallback, true);
    assert.match(plan.reason, /VK_ERROR_INCOMPATIBLE_DRIVER/u);
    await assert.rejects(
      planEnhance({ tools, clip: clip(), sourceMp4: 'x.mp4', config: config({ enabled: true, required: true }), probe: probe1080, status: broken }),
      /effects\.enhance\.required/u,
    );
  });

  it('シェーダが見つからなければフォールバック', async () => {
    const shadersDir = makeShadersDir();
    const plan = await planEnhance({
      tools,
      clip: clip(),
      sourceMp4: 'x.mp4',
      config: config({ enabled: true, shadersDir, restore: 'Restore_CNN_UL' }),
      probe: probe1080,
      status: available,
    });
    assert.equal(plan.applied, false);
    assert.equal(plan.fallback, true);
    assert.match(plan.reason, /Anime4K_Restore_CNN_UL\.glsl/u);
    fs.rmSync(shadersDir, { recursive: true, force: true });
  });
});

describe('buildPreset', () => {
  it('内容が同じなら書き直さず、書き換えられていれば戻す', () => {
    const shadersDir = makeShadersDir();
    const presetsDir = path.join(shadersDir, '.presets');
    const first = buildPreset({ names: ['Clamp_Highlights', 'Restore_CNN_M'], shadersDir, presetsDir });
    const body = fs.readFileSync(first, 'utf8');
    fs.writeFileSync(first, 'broken');
    const second = buildPreset({ names: ['Clamp_Highlights', 'Restore_CNN_M'], shadersDir, presetsDir });
    assert.equal(second, first);
    assert.equal(fs.readFileSync(second, 'utf8'), body);
    assert.throws(() => buildPreset({ names: ['Nope'], shadersDir, presetsDir }), /Anime4K_Nope\.glsl/u);
    fs.rmSync(shadersDir, { recursive: true, force: true });
  });
});

describe('フィルタ文字列', () => {
  const plan = { restorePreset: '/tmp/a:b/restore.glsl', upscalePreset: '/tmp/a:b/upscale.glsl' };

  it('復元は等倍 libplacebo、パスの : は escape する', () => {
    assert.equal(restoreFilter(plan), "libplacebo=custom_shader_path='/tmp/a\\:b/restore.glsl':format=yuv420p:dithering=none");
  });

  it('拡大は出力サイズを指定した libplacebo に置き換わる', () => {
    const upscale = upscaleFilter(plan, size);
    assert.match(upscale, /^libplacebo=w=1920:h=1080:custom_shader_path='\/tmp\/a\\:b\/upscale\.glsl':upscaler=ewa_lanczossharp/u);
    const zoom = { scale: 1.3, focus: { x: 0.7, y: 0.6 } };
    assert.deepEqual(zoomCropFilters({ zoom, size }).slice(1), ['scale=1920:1080:flags=lanczos', 'setsar=1']);
    assert.deepEqual(zoomCropFilters({ zoom, size, upscale }).slice(1), [upscale, 'setsar=1']);
  });
});

describe('補助', () => {
  it('shaderName は接頭辞と拡張子を落とす', () => {
    assert.equal(shaderName('Anime4K_Restore_CNN_M.glsl'), 'Restore_CNN_M');
    assert.equal(shaderName(' Upscale_CNN_x2_M '), 'Upscale_CNN_x2_M');
    assert.equal(shaderName(null), null);
    assert.equal(shaderName(''), null);
  });

  it('formatEnhanceLog', () => {
    assert.equal(formatEnhanceLog(null), null);
    assert.equal(formatEnhanceLog({ applied: false, reason: '手動OFF' }), '   ✨ 補正: なし (手動OFF)');
    assert.equal(
      formatEnhanceLog({ applied: true, restore: 'Restore_CNN_M', upscale: 'Upscale_CNN_x2_M', from: { w: 1920, h: 1080 } }),
      '   ✨ 補正: 復元 Restore_CNN_M / zoom 拡大 Upscale_CNN_x2_M (ソース 1920x1080)',
    );
  });
});
