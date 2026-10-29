import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAss } from './ass.js';
import { buildCardCommand, buildEndscreenElements, lastFrameBackgroundFilter, planCardRender } from './card.js';
import { DEFAULTS, deepMerge } from './config.js';

const size = { width: 1920, height: 1080, fps: 30 };

function endscreenConfig(patch = {}) {
  return deepMerge(DEFAULTS, deepMerge({
    source: 'cache',
    endcaps: { ending: { enabled: true, duration: 20, layout: 'endscreen' } },
  }, patch));
}

describe('エンドスクリーン', () => {
  it('枠の左右の縦線と、ラベルの所で途切れた上下の横線を描く', () => {
    const elements = buildEndscreenElements({ config: endscreenConfig(), size, duration: 20 });
    const frame = elements.find((el) => el.name === 'endscreen-frame');
    assert.deepEqual(elements.map((el) => el.name), ['endscreen-frame', 'endscreen-top', 'endscreen-bottom']);
    assert.equal(frame.shapes.length, 6);

    const top = frame.shapes.filter((shape) => shape.y === Math.round(1080 * 0.08) && shape.height < 20);
    assert.equal(top.length, 2);
    // 上のラベルは左寄りなので、左側の線は短く、右側の線が長い。
    assert.ok(top[0].width < top[1].width);
    const bottom = frame.shapes.filter((shape) => shape.y > 900);
    assert.equal(bottom.length, 2);
    assert.ok(bottom[0].width > bottom[1].width);
  });

  it('ラベルが無ければ横線を途切れさせない', () => {
    const config = endscreenConfig({ endcaps: { ending: { endscreen: { labels: { top: '', bottom: '' } } } } });
    const elements = buildEndscreenElements({ config, size, duration: 20 });
    assert.equal(elements.length, 1);
    assert.equal(elements[0].shapes.length, 4);
  });

  it('枠線は本文の無い図形として ASS に出す', () => {
    const elements = buildEndscreenElements({ config: endscreenConfig(), size, duration: 20 });
    const ass = buildAss(elements, { width: 1920, height: 1080, font: 'Hiragino Sans' });
    const dialogues = ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
    assert.equal(dialogues.filter((line) => line.includes('\\p1')).length, 6);
    assert.ok(dialogues.some((line) => line.endsWith('おすすめアーカイブはこちら')));
  });

  it('layout が default の ED は従来どおり「ご視聴ありがとうございました」', () => {
    const config = endscreenConfig({ endcaps: { ending: { layout: 'default' } } });
    const plan = planCardRender({ kind: 'ending', clips: [], index: 0, total: 0, config, size, duration: 4 });
    assert.deepEqual(plan.elements.map((el) => el.name), ['ending-text']);
  });

  it('最後のクリップの最終フレームをぼかして duration 秒ぶん複製する', () => {
    const filter = lastFrameBackgroundFilter({ bg: { blur: 40, brightness: -0.08 }, size, duration: 20 });
    assert.match(filter, /^trim=end_frame=1,setpts=PTS-STARTPTS,/);
    assert.match(filter, /gblur=sigma=40,eq=brightness=-0\.08,tpad=stop_mode=clone:stop_duration=20,fps=30,trim=duration=20$/);
  });

  it('ソースが無ければ通常のカード背景へ戻し、要求した種類を残す', () => {
    const config = endscreenConfig({ cards: { background: { type: 'solid', color: '112233' } } });
    const clips = [{ base: 'missing-clip', videoId: 'NO_SUCH_VIDEO' }];
    const plan = planCardRender({ kind: 'ending', clips, index: 0, total: 1, config, size, duration: 20 });
    assert.equal(plan.background.kind, 'color');
    assert.equal(plan.background.requested, 'lastClip');
  });

  it('エンドスクリーンはカード SE を鳴らさず無音にする', () => {
    const config = endscreenConfig({ cards: { background: { type: 'solid' }, se: { enabled: true } } });
    const args = buildCardCommand({
      kind: 'ending',
      clips: [],
      assPath: 'ending.ass',
      outPath: 'ending.mp4',
      config,
      size,
      duration: 20,
      thumbnail: null,
    });
    assert.ok(args.includes('anullsrc=r=44100:cl=stereo'));
  });
});
