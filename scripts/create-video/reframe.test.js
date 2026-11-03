import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULTS, deepMerge } from './config.js';
import { planReframe, reframeCropRect, planReframeLayout, pickFace, reframeFilters } from './reframe.js';
import { planClipRender } from './clip.js';
import { checkReframe } from './qc/checks/probe.js';
import { sourceCompareFilters } from './qc/checks/sync.js';

const source = { width: 1920, height: 1080, duration: 6 };
const size = { width: 1080, height: 1920, fps: 30 };
const config = deepMerge(DEFAULTS, { effects: { reframe: { enabled: true } } });
const args = { tools: {}, clip: { data: {} }, sourceMp4: 'in.mp4', config, size, probe: source, workDir: '/tmp' };

describe('reframe', () => {
  it('元映像いっぱいの高さで縦に切り出し、原点を偶数と映像内にクランプする', () => {
    assert.deepEqual(reframeCropRect({ source, size, focus: { x: 1, y: 1 } }), { x: 1312, y: 0, w: 608, h: 1080 });
    assert.deepEqual(reframeCropRect({ source, size, focus: { x: 0, y: 0 }, zoom: 2 }), { x: 0, y: 0, w: 304, h: 540 });
    const wide = reframeCropRect({ source: size, size: source, focus: { x: 0.5, y: 0.5 } });
    assert.equal(wide.w, 1080);
    assert.ok(wide.h < 1920);
  });

  it('3フレームの最大顔の中心から各軸の中央値を使い、元座標で検出する', async () => {
    let request;
    const plan = await planReframe({ ...args, detect: async r => {
      request = r;
      return [{ x: 1400, y: 600, w: 200, h: 200 }, { x: 1420, y: 620, w: 200, h: 200 }, { x: 0, y: 0, w: 200, h: 200 }];
    } });
    assert.equal(request.sourceCoordinates, true);
    assert.equal(request.allFaces, true);
    assert.equal(plan.faceHeight, 200 / 1080);
    assert.deepEqual(request.times, [1, 3, 5]);
    assert.equal(request.size.width, 1920);
    assert.deepEqual(plan.focus, { x: 1500 / 1920, y: 700 / 1080, source: 'face' });
    assert.equal(plan.fallback, false);
  });

  it('顔未検出なら全体の x/y、無ければ中央へ戻り、QC に warn を残す', async () => {
    const detect = async () => [];
    const center = await planReframe({ ...args, detect });
    assert.deepEqual(center.focus, { x: 0.5, y: 0.5, source: 'center' });
    const fixed = await planReframe({ ...args, detect, config: deepMerge(config, { effects: { reframe: { x: 0.8, y: 0.7 } } }) });
    assert.equal(fixed.focus.source, 'config');
    assert.equal(fixed.focus.x, 0.8);
    assert.equal(fixed.fallback, true);
    assert.deepEqual(checkReframe({ manifest: { segments: [{ kind: 'clip', base: 'a', reframe: fixed }] } }).map(r => [r.code, r.level]), [['reframe_face_fallback', 'warn']]);
  });

  it('既定OFF・個別falseは検出せず、個別手動は全体OFFでも有効。zoomのみは顔検出を継承', async () => {
    const detect = async () => {
      throw Error('検出しない');
    };
    assert.equal(await planReframe({ ...args, config: DEFAULTS, detect }), null);
    assert.equal(await planReframe({ ...args, clip: { data: { effects: { reframe: false } } }, detect }), null);
    const manual = await planReframe({ ...args, config: DEFAULTS, clip: { data: { effects: { reframe: { x: 2, y: -1, zoom: 2 } } } }, detect });
    assert.deepEqual(manual.focus, { x: 1, y: 0, source: 'manual' });
    assert.equal(manual.zoom, 3);
    assert.equal(manual.frame.h, 360);
    assert.equal(manual.zoomReason, 'cap');
    assert.equal(manual.fallback, false);
    const zoomOnly = await planReframe({ ...args, clip: { data: { effects: { reframe: { zoom: 1.5 } } } }, detect: async () => [] });
    assert.equal(zoomOnly.zoom, 1.5);
    assert.equal(zoomOnly.fallback, true);
  });

  it('共有描画計画は crop → restore → CNN拡大 → ASS。zoom/avoidFace は抑止', async () => {
    const reframe = await planReframe({ ...args, detect: async () => [] });
    const logs = [];
    const plan = await planClipRender({ ...args, index: 0, total: 1, assPath: '/tmp/reframe.ass',
      config: deepMerge(config, { effects: { zoom: { enabled: true } } }),
      plans: { reframe, enhance: { applied: true, restorePreset: '/tmp/restore.glsl', upscalePreset: '/tmp/upscale.glsl', from: {} },
        zoom: { at: 1, scale: 1.3 }, avoid: { applied: true } }, log: s => logs.push(s) });
    assert.equal(plan.zoom, null);
    assert.equal(plan.avoid, null);
    assert.ok(logs.some(s => s.includes('zoom をスキップ')));
    assert.ok(logs.some(s => s.includes('avoidFace をスキップ')));
    const vf = plan.graph.vf;
    assert.ok(vf.startsWith(`crop=${reframe.crop.w}:${reframe.crop.h}:`));
    assert.ok(vf.indexOf('crop=') < vf.indexOf('restore.glsl'));
    assert.ok(vf.indexOf('restore.glsl') < vf.indexOf('libplacebo=w=1080:h=1920'));
    assert.ok(vf.indexOf('upscale.glsl') < vf.indexOf('subtitles='));
    assert.ok(!vf.includes('pad='));
    const compare = sourceCompareFilters({ reframe }, size, 'crop=200:200:0:0');
    assert.ok(compare.startsWith(reframeFilters(reframe, size)));
    assert.ok(!compare.includes('pad='));
  });
});


describe('reframe の顔選択と構図', () => {
  it('最大の高さの50%以上の候補から最も右を選び、小さいアイコンを除外する', () => {
    const left = { x: 100, y: 500, w: 400, h: 400 };
    const right = { x: 1600, y: 700, w: 220, h: 200 };
    const icon = { x: 1880, y: 0, w: 30, h: 30 };
    assert.equal(pickFace([right, icon, left]), left);
    assert.equal(pickFace([left, icon, right], 'right'), right);
    assert.equal(pickFace([], 'right'), null);
    const wide = { x: 0, y: 0, w: 500, h: 200 };
    const tall = { x: 500, y: 0, w: 10, h: 300 };
    const candidate = { x: 1000, y: 0, w: 100, h: 110 };
    assert.equal(pickFace([wide, tall, candidate], 'right'), candidate);
  });

  it('フレームごとに右の顔を選んでから中心・高さの中央値を求める', async () => {
    const plan = await planReframe({ ...args, config: deepMerge(config, { effects: { reframe: { pick: 'right' } } }),
      detect: async () => [
        [{ x: 100, y: 100, w: 400, h: 400 }, { x: 1500, y: 700, w: 200, h: 200 }],
        [],
        [{ x: 100, y: 100, w: 400, h: 400 }, { x: 1540, y: 700, w: 220, h: 220 }],
        [{ x: 100, y: 100, w: 400, h: 400 }, { x: 1600, y: 680, w: 240, h: 240 }],
      ] });
    assert.equal(plan.focus.x, 1650 / 1920);
    assert.equal(plan.focus.y, 800 / 1080);
    assert.equal(plan.faceHeight, 220 / 1080);
  });

  it('min / center / face size / cap の各倍率を選び、targetを守る', () => {
    const layout = (focus, setting, faceHeight = null) => planReframeLayout({ source, size, focus, setting, faceHeight });
    const min = layout({ x: 0.5, y: 0.4 }, { target: { x: 0.5, y: 0.4 }, zoom: 1.5 });
    assert.equal(min.zoom, 1.5);
    assert.equal(min.zoomReason, 'min');
    const center = layout({ x: 0.5, y: 0.7 }, { target: { x: 0.5, y: 0.4 }, maxZoom: 3 });
    assert.ok(Math.abs(center.zoom - 2) < 1e-6);
    assert.equal(center.zoomReason, 'center');
    assert.equal(center.fill, null);
    const face = layout({ x: 0.5, y: 0.4 }, { target: { x: 0.5, y: 0.4 }, minFaceHeight: 0.3, maxZoom: 3 }, 0.1);
    assert.equal(face.zoom, 3);
    assert.equal(face.zoomReason, 'face size');
    const cap = layout({ x: 0.99, y: 0.8 }, { target: { x: 0.5, y: 0.4 }, maxZoom: 1.8, fill: 'blur' });
    assert.equal(cap.zoom, 1.8);
    assert.equal(cap.zoomReason, 'cap');
    assert.equal(cap.frame.x + cap.frame.w, 1920);
    assert.ok(cap.frame.y + cap.frame.h > 1080);
    assert.equal(cap.fill, 'blur');
    const actualY = cap.foreground.y + (0.8 * 1080 - cap.crop.y) * cap.foreground.h / cap.crop.h;
    assert.ok(Math.abs(actualY - 0.4 * 1920) < 8);
    for (const rect of [cap.frame, cap.crop]) {
      for (const value of Object.values(rect)) {
        assert.equal(value % 2, 0);
      }
    }
  });

  it('target上端・焦点が映像端でも前景が空にならず、manifestをJSON化できる', () => {
    const plan = planReframeLayout({ source, size, focus: { x: 1, y: 1 }, setting: { target: { x: 0.5, y: 0 }, maxZoom: 1.8 } });
    assert.ok(plan.crop.h >= 2);
    assert.ok(plan.foreground.h >= 2);
    assert.equal(plan.zoomNeeded.center, null);
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  });

  it('上側の不足も背景で埋め、cropには負の座標を渡さない', () => {
    const plan = planReframeLayout({ source, size, focus: { x: 0.5, y: 0.05 }, setting: { target: { x: 0.5, y: 0.4 }, maxZoom: 1.8, fill: 'black' } });
    assert.ok(plan.frame.y < 0);
    assert.equal(plan.crop.y, 0);
    assert.ok(plan.foreground.y > 0);
    assert.ok(reframeFilters(plan, size).includes(`pad=1080:1920:0:${plan.foreground.y}:color=black`));
    const blur = reframeFilters({ ...plan, fill: 'blur' }, size);
    assert.ok(blur.includes('split=2[rfbg][rffg]'));
    assert.ok(blur.includes('boxblur=8:1'));
    assert.ok(blur.includes(`overlay=x=0:y=${plan.foreground.y}`));
    const results = checkReframe({ manifest: { segments: [{ kind: 'clip', base: 'a', reframe: plan }] } });
    assert.deepEqual(results.map(r => [r.code, r.level]), [['reframe_fill', 'info']]);
  });
});
