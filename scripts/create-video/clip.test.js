import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { elementTextRect } from './ass.js';
import { buildClipElements } from './clip.js';
import { DEFAULTS, deepMerge } from './config.js';

const size = { width: 1920, height: 1080, fps: 30 };

function serifOf(config, base) {
  const clip = { base, data: { serif: 'ショーを見せましょう' }, startTime: 0, endTime: 3, meta: {} };
  return buildClipElements({ clip, index: 0, total: 1, config, size, titleOverride: null })
    .find((el) => el.name === 'serif');
}

describe('buildClipElements', () => {
  it('telops.serif.alignOverrides に書いたクリップだけセリフの align を変える', () => {
    const config = deepMerge(DEFAULTS, {
      telops: { serif: { align: 'bottom-center', alignOverrides: { target: 'center' } } },
    });
    const moved = serifOf(config, 'target');
    const other = serifOf(config, 'other');
    assert.equal(moved.align, 'center');
    assert.equal(other.align, 'bottom-center');
    // 矩形（QC・manifest が使う）も上書き後の位置で測る。
    const movedRect = elementTextRect(moved, size.width, size.height);
    const otherRect = elementTextRect(other, size.width, size.height);
    assert.ok(Math.abs(movedRect.y + movedRect.h / 2 - size.height / 2) <= 1);
    assert.ok(otherRect.y > movedRect.y);
    // 設定そのものは書き換えない。
    assert.equal(config.telops.serif.align, 'bottom-center');
  });
});
