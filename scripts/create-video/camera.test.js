import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCamera, aspectKey, cameraRectAt, cameraExprAst, evalExpr, exprToString, shiftCamera } from './camera.js';
import { displayVideoSize } from './ffmpeg.js';
import { planCamera } from './camera-render.js';
import { planClipRender } from './clip.js';
import { DEFAULTS } from './config.js';

const source = { width: 1920, height: 1080 };
const frames = [{ t: 1, x: 0.1, y: 0.2, zoom: 1 }, { t: 3, x: 0.9, y: 0.8, zoom: 4 }];
describe('camera', () => {
  it('検証・時刻の整列・重複と範囲の拒否', () => {
    assert.equal(normalizeCamera([...frames].reverse()).keyframes[0].t, 1);
    for (const value of [[], [{ ...frames[0], zoom: 5 }], [frames[0], frames[0]], [{ ...frames[0], t: NaN }], [{ ...frames[0], ease: 'bad' }]]) {
      assert.ok(normalizeCamera(value).error);
    }
    assert.equal(aspectKey({ width: 1080, height: 1920 }), '9:16');
    assert.equal(aspectKey({ width: 100, height: 200 }), null);
  });
  for (const ease of ['smooth', 'linear', 'cut']) {
    it(`${ease}: AST と直接補間が境界・途中・クランプで一致`, () => {
      const keys = frames.map((frame) => ({ ...frame, ease }));
      const ast = cameraExprAst(keys, source, '9:16');
      assert.match(exprToString(ast.x), /if\(lt\(t,3\)/u);
      for (let t = 0; t < 5; t += 0.031) {
        const rect = cameraRectAt(keys, t, source, '9:16');
        for (const key of ['x', 'y', 'w', 'h']) {
          assert.ok(Math.abs(rect[key] - evalExpr(ast[key], t)) < 1e-8);
        }
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= source.width + 1e-8);
      }
      const shifted = shiftCamera(keys, 2, 2);
      assert.equal(shifted[0].t, 0);
      assert.equal(shifted.at(-1).t, 2);
      assert.deepEqual(cameraRectAt(shifted, 0, source, '9:16'), cameraRectAt(keys, 2, source, '9:16'));
    });
  }
  it('SAR と回転を表示寸法に反映', () => {
    assert.deepEqual(displayVideoSize({ width: 1920, height: 1080, sample_aspect_ratio: '2:1', side_data_list: [{ rotation: 90 }] }), { width: 1080, height: 3840 });
  });
  it('camera のないクリップは tools が空でも probe しない', async () => {
    assert.equal(await planCamera({ tools: {}, clip: { data: {} }, config: DEFAULTS, size: source }), null);
  });
  it('camera は reframe/zoom/avoid を抑止し vf で crop 式を描く', async () => {
    const camera = { applied: true, backend: 'libplacebo', aspect: '16:9', keyframes: frames, from: source };
    const plan = await planClipRender({ tools: {}, clip: { data: { serif: '' }, duration: 5 }, config: DEFAULTS,
      size: { ...source, fps: 30 }, index: 0, total: 1, assPath: '/tmp/camera.ass', plans: { camera, enhance: false } });
    assert.equal(plan.reframe, null);
    assert.equal(plan.zoom, null);
    assert.equal(plan.avoid, null);
    assert.equal(plan.graph.complex, undefined);
    assert.match(plan.graph.vf, /libplacebo=.*crop_x='/u);
  });
});

// 数値の期待値も固定し、AST と直接評価が同じ誤りを持つ場合を検出する。
describe('camera の境界と描画経路', () => {
  it('中心は線形・倍率は対数、cut は次の時刻で切り替える', async () => {
    const { cameraFrameAt, baseRect } = await import('./camera.js');
    const keys = [{ t: 0, x: 0.2, y: 0.4, zoom: 1, ease: 'linear' }, { t: 4, x: 0.8, y: 0.6, zoom: 4, ease: 'cut' }, { t: 5, x: 0.5, y: 0.5, zoom: 1 }];
    assert.equal(cameraFrameAt(keys, 2).zoom, 2);
    assert.equal(cameraFrameAt(keys, 2).x, 0.5);
    assert.equal(cameraFrameAt(keys, 4.999).zoom, 4);
    assert.equal(cameraFrameAt(keys, 5).zoom, 1);
    assert.equal(cameraFrameAt([{ ...keys[0], ease: 'smooth' }, keys[1]], 1).x, 0.29375);
    assert.deepEqual(baseRect(source, '1:1'), { w: 1080, h: 1080 });
    assert.deepEqual(baseRect({ width: 1080, height: 1920 }, '16:9'), { w: 1080, h: 607.5 });
    for (const aspect of ['9:16', '16:9', '1:1']) {
      const ast = cameraExprAst(keys, source, aspect);
      for (const t of [-1, 0, 0.7, 4, 4.9999, 5, 9]) {
        const rect = cameraRectAt(keys, t, source, aspect);
        for (const key of Object.keys(rect)) {
          assert.ok(Math.abs(evalExpr(ast[key], t) - rect[key]) < 1e-8);
        }
      }
    }
  });
  it('単一枠・最初より前・最後より後も shift でき、元の配列を変えない', () => {
    const key = [{ t: 2, x: 0.7, y: 0.4, zoom: 2 }];
    assert.deepEqual(shiftCamera(key, 0, 8).map((frame) => frame.t), [0, 2, 8]);
    assert.deepEqual(shiftCamera(key, 4, 2).map((frame) => frame.t), [0, 2]);
    assert.equal(key[0].t, 2);
    const shifted = shiftCamera(frames, 1, 2);
    assert.deepEqual(shifted.map((frame) => frame.t), [0, 2]);
  });
  it('OFF・別アスペクト・不正値は probe 前に抜ける', async () => {
    for (const [camera, config, size] of [[{ '16:9': frames }, { effects: { camera: { enabled: false } } }, source],
      [{ '9:16': frames }, DEFAULTS, source], [{ '16:9': [] }, DEFAULTS, source]]) {
      assert.equal(await planCamera({ tools: {}, clip: { data: { effects: { camera } } }, config, size }), null);
    }
  });
  it('libplacebo は enhance 無しでも使い、fallback はフレームごとの命令を書き出す', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { cameraFilters } = await import('./camera-render.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-test-'));
    try {
      const args = { tools: {}, clip: { data: { effects: { camera: { '16:9': frames } } } }, config: DEFAULTS,
        size: { ...source, fps: 30 }, probe: { ...source, duration: 4 }, sourceMp4: 'test.mp4', workDir: dir };
      const gpu = await planCamera({ ...args, status: { ok: true } });
      const filter = cameraFilters(gpu, args.size, { enhance: { applied: true, restorePreset: 'restore.glsl', upscalePreset: 'upscale.glsl' } });
      assert.ok(filter.indexOf('fps=') < filter.indexOf('restore.glsl'));
      assert.ok(filter.indexOf('restore.glsl') < filter.indexOf('crop_x='));
      assert.match(filter, /upscale.glsl/u);
      assert.match(cameraFilters(gpu, args.size), /libplacebo=.*upscaler=ewa_lanczossharp/u);
      const cpu = await planCamera({ ...args, status: { ok: false, reason: 'test' } });
      assert.equal(cpu.fallback, true);
      assert.equal(fs.readFileSync(cpu.commands, 'utf8').split('\n').length, 121);
      assert.match(cameraFilters(cpu, args.size), /sendcmd=.*crop=.*scale=1920:1080:flags=lanczos/u);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
