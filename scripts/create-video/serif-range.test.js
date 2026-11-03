import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULTS, deepMerge, loadConfig } from './config.js';
import { planSerifRange } from './serif-range.js';
import { buildClipElements, planClipRender } from './clip.js';
import { elementTextRect } from './ass.js';
import { reframeCompareCrop } from './qc/checks/sync.js';

const size = { width: 1080, height: 1920, fps: 30 };
const config = deepMerge(DEFAULTS, { telops: { serif: { layout: 'space-lines', faceRange: { enabled: true } } } });
const reframe = { applied: true, fallback: false, faceHeight: 0.2, zoom: 1.8, target: { x: 0.5, y: 0.46 } };

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

describe('serif face range', () => {
  it('出力上の顔の枠の上端から高さを決める', () => {
    const range = planSerifRange({ config, reframe, size });
    assert.equal(range.source, 'face');
    near(range.faceTop, 1920 * (0.46 - 0.2 * 1.8 / 2));
    near(range.top, 1920 * 0.02);
    near(range.bottom, range.faceTop);
    assert.equal(range.clamped, null);
  });

  it('丸めたframeがあるときは元の顔を実際の出力座標に写す', () => {
    const geometry = { ...reframe, from: { height: 1080 }, frame: { y: 480, h: 600 }, focus: { y: 0.7 } };
    const range = planSerifRange({ config, reframe: geometry, size });
    near(range.faceTop, (0.7 * 1080 - 0.2 * 1080 / 2 - 480) * 1920 / 600);
  });

  it('狭すぎる範囲は12%まで広げ、広すぎる範囲は30%で止める', () => {
    const min = planSerifRange({ config, reframe: { ...reframe, faceHeight: 0.5 }, size });
    near(min.height, size.height * 0.12);
    assert.equal(min.clamped, 'min');
    assert.ok(min.bottom > min.faceTop);
    const max = planSerifRange({ config, reframe: { ...reframe, faceHeight: 0.02 }, size });
    near(max.height, size.height * 0.30);
    assert.equal(max.clamped, 'max');
    assert.ok(max.bottom < max.faceTop);
  });

  it('fallback・顔サイズ無し・reframe無しは固定2〜24%、既定は無効', () => {
    for (const plan of [null, { ...reframe, fallback: true }, { ...reframe, faceHeight: null }, { ...reframe, applied: false }]) {
      const range = planSerifRange({ config, reframe: plan, size });
      assert.equal(range.source, 'fallback');
      near(range.top, size.height * 0.02);
      near(range.bottom, size.height * 0.24);
    }
    assert.equal(planSerifRange({ config: DEFAULTS, reframe, size }), null);
  });

  it('QCはセリフ範囲を外し、比較領域が不足する設定では誤検知を避ける', () => {
    assert.equal(reframeCompareCrop(size, { reframe, serifRange: { bottom: size.height * 0.8 } }), null);
  });

  it('共有描画計画へ範囲を渡し、行別サイズのブロックをその上下中央に置く', async () => {
    const cfg = loadConfig(['--config', 'scripts/create-video/config-shorts.json']);
    const clip = { data: { serif: '短い 長めのセリフ' }, startTime: 0, endTime: 3, meta: {} };
    const plan = await planClipRender({ config: cfg, clip, index: 0, total: 1, size, tools: {},
      workDir: '/tmp', sourceMp4: '', assPath: '/tmp/range.ass', plans: { reframe: { ...reframe, focus: { source: 'face' }, crop: { x: 100, y: 100, w: 338, h: 600 } }, enhance: false, avoid: false, zoom: false }, log: () => {} });
    const serif = plan.elements.find(el => el.name === 'serif');
    const rect = elementTextRect(serif, size.width, size.height);
    assert.equal(serif.marginL, 50);
    assert.equal(serif.marginR, 50);
    assert.ok(serif.lineSizes[0] > 163);
    assert.ok(rect.y >= plan.serifRange.top - 1);
    assert.ok(rect.y + rect.h <= plan.serifRange.bottom + 1);
    assert.ok(Math.abs(rect.y + rect.h / 2 - (plan.serifRange.top + plan.serifRange.bottom) / 2) < 1);
    const again = buildClipElements({ clip, config: cfg, size, index: 0, total: 1, serifRange: plan.serifRange });
    assert.deepEqual(again.find(el => el.name === 'serif').lineSizes, serif.lineSizes);
    const roi = reframeCompareCrop(size, { reframe, serifRange: plan.serifRange });
    const [, w, h, x, y] = /crop=(\d+):(\d+):(\d+):(\d+)/u.exec(roi).map(Number);
    assert.ok(w > 0 && h > 0 && x >= 0);
    assert.ok(y > plan.serifRange.bottom);
  });
});
