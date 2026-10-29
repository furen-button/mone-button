import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULTS, deepMerge } from '../../config.js';
import { checkClipDurations } from './probe.js';

function check(segment, config = DEFAULTS) {
  return checkClipDurations({ manifest: { segments: [{ kind: 'clip', base: 'clip-a', ...segment }] }, config });
}

describe('checkClipDurations', () => {
  it('短すぎる・長すぎるクリップを error にする', () => {
    for (const durationSec of [1.917, 7.444]) {
      const results = check({ durationSec, expectedSec: 6.858 });
      assert.equal(results.length, 1);
      assert.equal(results[0].level, 'error');
      assert.equal(results[0].code, 'clip_duration_mismatch');
      assert.match(results[0].message, /clip-a/u);
      assert.equal(results[0].detail, `実尺 ${durationSec.toFixed(3)}s / 期待 6.858s（トリム尺）`);
    }
  });

  it('許容内と境界は何も出さない', () => {
    for (const durationSec of [7.75, 7.89, 8, 8.11, 8.25]) {
      assert.deepEqual(check({ durationSec, expectedSec: 8 }), []);
    }
  });

  it('設定した許容尺を使う', () => {
    const config = deepMerge(DEFAULTS, { qc: { thresholds: { clipDurationMs: 100 } } });
    assert.equal(check({ durationSec: 7.89, expectedSec: 8 }, config).length, 1);
  });

  it('期待尺が無い旧 manifest・無効な期待尺・clip 以外は何も出さない', () => {
    for (const expectedSec of [undefined, null, 0, -1, NaN, Infinity]) {
      assert.deepEqual(check({ durationSec: 2, expectedSec }), []);
    }
    assert.deepEqual(check({ kind: 'card', durationSec: 2, expectedSec: 8 }), []);
    assert.deepEqual(checkClipDurations({ manifest: null, config: DEFAULTS }), []);
  });
});
