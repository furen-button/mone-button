import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { charWidth, stripEmoji, wrapText } from './ass.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  fs.readFileSync(path.join(here, '__fixtures__', 'wrap-golden.json'), 'utf8'),
);

// runs は「出力が変わる maxUnits」だけを記録した RLE。全 maxUnits に展開して返す。
function expandRuns(runs, [min, max]) {
  const out = new Map();
  let cursor = 0;
  for (let mu = min; mu <= max; mu++) {
    while (cursor + 1 < runs.length && runs[cursor + 1][0] <= mu) {
      cursor++;
    }
    out.set(mu, runs[cursor][1]);
  }
  return out;
}

describe('charWidth', () => {
  it('U+02FF 以下と半角カナを 0.5 幅として数える', () => {
    assert.equal(charWidth('a'), 0.5);
    assert.equal(charWidth('˿'), 0.5);
    assert.equal(charWidth('ｱ'), 0.5);
    assert.equal(charWidth('ﾟ'), 0.5);
  });

  it('U+0300 以上の全角文字を 1 幅として数える', () => {
    assert.equal(charWidth('̀'), 1);
    assert.equal(charWidth('あ'), 1);
    assert.equal(charWidth('【'), 1);
    assert.equal(charWidth('🎉'), 1);
  });
});

describe('wrapText の後方互換', () => {
  // 禁則処理を入れる前の出力を固定した基準値。kinsoku を切れば完全一致し続けること。
  it(`実データ ${golden.inputs} 文字列 × maxUnits ${golden.range[0]}..${golden.range[1]} が基準値と一致する`, () => {
    let checked = 0;
    for (const { input, runs } of golden.cases) {
      const expected = expandRuns(runs, golden.range);
      const stripped = stripEmoji(input);
      for (const [maxUnits, want] of expected) {
        const got = wrapText(stripped, maxUnits, { kinsoku: false });
        assert.equal(got, want, `maxUnits=${maxUnits} / input=${JSON.stringify(input)}`);
        checked++;
      }
    }
    assert.equal(checked, golden.inputs * (golden.range[1] - golden.range[0] + 1));
  });
});
