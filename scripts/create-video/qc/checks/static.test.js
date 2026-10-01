import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULTS, deepMerge } from '../../config.js';
import { overlapAreaRatio, runStaticChecks } from './static.js';

const size = { width: 640, height: 360, fps: 30 };

function baseConfig(override = {}) {
  return deepMerge(DEFAULTS, deepMerge({
    source: 'cache',
    cards: { enabled: false },
    endcaps: { opening: { enabled: false }, ending: { enabled: false } },
    summary: { enabled: false },
    telops: {
      title: { enabled: false },
      date: { enabled: false },
      time: { enabled: false },
      serif: { enabled: true, align: 'bottom-center', size: 0.08 },
      progress: { enabled: false },
    },
  }, override));
}

function clip(override = {}) {
  return {
    file: '2024-01-01-abc-000000-000002.json',
    base: '2024-01-01-abc-000000-000002',
    data: {
      serif: 'こんにちは',
      clipUrl: 'https://example.test/clip',
      ...(override.data || {}),
    },
    videoId: 'abc',
    categories: ['test'],
    startTime: 0,
    endTime: 2,
    duration: 2,
    uploadDate: '20240101',
    meta: { uploadDate: '20240101', title: 'タイトル' },
    ...override,
  };
}

function codes(results) {
  return results.map((item) => item.code);
}

describe('L0 static checks', () => {
  it('テロップ矩形の衝突を error にする', () => {
    const config = baseConfig({
      telops: {
        title: { enabled: true, align: 'top-center', text: '重なるタイトル', size: 0.08 },
        date: { enabled: true, align: 'top-center', size: 0.08 },
      },
    });
    assert.ok(codes(runStaticChecks({ config, clips: [clip()], size })).includes('static_telop_collision'));
  });

  it('テロップの画面外はみ出しを error にする', () => {
    const config = baseConfig({
      telops: {
        serif: { box: { width: 1000 } },
      },
    });
    assert.ok(codes(runStaticChecks({ config, clips: [clip()], size })).includes('static_telop_outside'));
  });

  it('同じ base の重複を error にする', () => {
    const one = clip();
    const two = clip({ file: 'dup.json' });
    assert.ok(codes(runStaticChecks({ config: baseConfig(), clips: [one, two], size })).includes('static_duplicate_clip'));
  });

  it('date order の単調性違反を error にする', () => {
    const config = baseConfig({ select: { order: 'date', mode: 'category' } });
    const late = clip({ base: 'late', file: 'late.json', uploadDate: '20240102' });
    const early = clip({ base: 'early', file: 'early.json', uploadDate: '20240101' });
    assert.ok(codes(runStaticChecks({ config, clips: [late, early], size })).includes('static_order_not_monotonic'));
  });

  // 1920x1080 の既定プリセットで実測した矩形。1 行タイトルは date と端が触れるだけで、
  // 実フレームでは重なっていない（緑のタイトルバーの上に date が乗るデザイン）。
  it('推定幅どうしが端で触れただけなら衝突にしない', () => {
    const title = { x: 210, y: 18, w: 1501, h: 40 };
    const date = { x: 1688, y: 49, w: 165, h: 40 };
    const ratio = overlapAreaRatio(title, date);
    assert.ok(ratio > 0, '矩形としては接触している');
    assert.ok(ratio < 0.2, `既定しきい値 0.2 を下回る（実測 ${(ratio * 100).toFixed(1)}%）`);
  });

  // 過去実害: 2 行タイトルが横 1711px まで伸びて date / progress を覆った。
  it('2 行タイトルが date を覆う場合は衝突にする', () => {
    const title = { x: 104, y: 18, w: 1711, h: 80 };
    const date = { x: 1688, y: 49, w: 165, h: 40 };
    assert.ok(overlapAreaRatio(title, date) >= 0.2);
  });

  it('離れた矩形は 0 を返す', () => {
    assert.equal(overlapAreaRatio({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), 0);
  });

  // 画面上で他を隠すのは不透明なボックスなので、ボックスがあれば box 矩形で判定する。
  // 既定プリセットではセリフボックスがほぼ全幅で、右下の time がその角に乗っていた（実フレームで確認）。
  it('不透明なボックスは box 矩形で遮蔽判定する', () => {
    const config = baseConfig({
      telops: {
        serif: { enabled: true, align: 'bottom-center', size: 0.08, box: { enabled: true, width: 600 } },
        time: { enabled: true, align: 'bottom-right', size: 0.06 },
      },
    });
    const results = runStaticChecks({ config, clips: [clip()], size });
    assert.ok(codes(results).includes('static_telop_collision'));
  });

  // title のボックスは全幅の背景バーで、date と progress はその上に乗るのが意図的なデザイン。
  it('title の背景バーは遮蔽判定から除く', () => {
    const config = baseConfig({
      telops: {
        title: { enabled: true, align: 'top-center', text: '短title', size: 0.05, box: { enabled: true } },
        date: { enabled: true, align: 'top-right', size: 0.05 },
        progress: { enabled: true, align: 'top-left', size: 0.05 },
      },
    });
    const results = runStaticChecks({ config, clips: [clip()], size });
    assert.ok(!codes(results).includes('static_telop_collision'));
  });

  it('同じ対・同じ位置の衝突は 1 件へまとめる', () => {
    const config = baseConfig({
      telops: {
        title: { enabled: true, align: 'top-center', text: '重なるタイトル', size: 0.08 },
        date: { enabled: true, align: 'top-center', size: 0.08 },
      },
    });
    const clips = [clip(), clip({ base: 'another', file: 'another.json' })];
    const collisions = runStaticChecks({ config, clips, size })
      .filter((item) => item.code === 'static_telop_collision');
    assert.equal(collisions.length, 1);
    assert.match(collisions[0].message, /2 箇所/u);
  });

  it('serif 行数上限超過を warn にする', () => {
    const config = baseConfig({ qc: { static: { maxSerifLines: 4 } } });
    const results = runStaticChecks({
      config,
      clips: [clip({ data: { serif: '1\n2\n3\n4\n5', clipUrl: 'https://example.test/clip' } })],
      size,
    });
    const lineResult = results.find((item) => item.code === 'static_serif_lines');
    assert.equal(lineResult?.level, 'warn');
  });
});
