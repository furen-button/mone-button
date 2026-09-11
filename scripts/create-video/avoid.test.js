import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeTextElement, textBoxRect } from './ass.js';
import { chooseAvoidance } from './avoid.js';
import { DEFAULTS } from './config.js';

// 1920x1080 の既定プリセットで実測した値。演者は右側に立ち、顔は x 1362-1727 / y 628-993。
const width = 1920;
const marginH = 154;
const gap = 24;
const minWidth = 864; // 0.45

describe('chooseAvoidance', () => {
  it('右側の顔を避けて左にボックスを収める', () => {
    const plan = chooseAvoidance({ face: { x: 1362, y: 628, w: 365, h: 365 }, width, marginH, gap, minWidth });
    assert.equal(plan.applied, true);
    assert.equal(plan.side, 'left');
    assert.equal(plan.marginL, marginH);
    // 右マージンは顔の左端から gap だけ手前で止まる
    assert.equal(plan.marginR, width - (1362 - gap));
    assert.ok(width - plan.marginL - plan.marginR >= minWidth);
  });

  it('左側の顔なら右にボックスを収める', () => {
    const plan = chooseAvoidance({ face: { x: 200, y: 600, w: 400, h: 400 }, width, marginH, gap, minWidth });
    assert.equal(plan.applied, true);
    assert.equal(plan.side, 'right');
    assert.equal(plan.marginL, 200 + 400 + gap);
    assert.equal(plan.marginR, marginH);
  });

  it('顔が中央にあって両側とも狭ければ見送る（全幅のまま）', () => {
    const plan = chooseAvoidance({ face: { x: 700, y: 600, w: 520, h: 400 }, width, marginH, gap, minWidth });
    assert.equal(plan.applied, false);
    assert.equal(plan.fallback, true);
    assert.match(plan.reason, /幅不足/u);
  });

  it('side を手で指定すれば広い側でなくてもそちらへ寄せる', () => {
    const plan = chooseAvoidance({ face: { x: 1362, y: 628, w: 365, h: 365 }, width, marginH, gap, minWidth, side: 'right' });
    // 右側は 1920-1727-24-154 = 15px しか無いので見送りになる
    assert.equal(plan.applied, false);
    assert.equal(plan.side, 'right');
  });
});

describe('左右非対称マージンのセリフボックス', () => {
  const style = { ...DEFAULTS.telops.serif, avoidFace: { enabled: false } };
  const height = 1080;

  it('marginL / marginR を渡すとボックス幅と位置がそれに従う', () => {
    const element = makeTextElement({
      name: 'serif',
      text: 'こんにちは',
      style,
      width,
      height,
      duration: 1,
      overrides: { marginL: 154, marginR: 582 },
    });
    const rect = textBoxRect(element, width, height);
    assert.equal(rect.x, 154);
    assert.equal(rect.width, width - 154 - 582);
  });

  it('長いセリフは狭めた幅で折り返す', () => {
    const text = 'そうやって短気だったりするんだ え〜彼女さん厳しい 私だったらそんなことしないのに';
    const full = makeTextElement({ name: 'serif', text, style, width, height, duration: 1 });
    const narrow = makeTextElement({
      name: 'serif',
      text,
      style,
      width,
      height,
      duration: 1,
      overrides: { marginL: 154, marginR: 582 },
    });
    const lines = (value) => value.text.split('\n').length;
    assert.ok(lines(narrow) >= lines(full), '狭い方が行数は同じか増える');
    // 行の推定幅は狭めたボックスに収まる
    const maxUnits = Math.max(...narrow.text.split('\n').map((line) => [...line].length));
    assert.ok(maxUnits * narrow.size <= (width - 154 - 582) / 0.97 + narrow.size);
  });

  it('marginL / marginR を渡さなければ従来どおり左右対称', () => {
    const element = makeTextElement({ name: 'serif', text: 'こんにちは', style, width, height, duration: 1 });
    const rect = textBoxRect(element, width, height);
    assert.equal(rect.x, marginH);
    assert.equal(rect.width, width - marginH * 2);
  });
});
