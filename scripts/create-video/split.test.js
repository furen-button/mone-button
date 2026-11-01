import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitClips, partOutputPath, selectParts } from './split.js';
import { loadConfig } from './config.js';
import { collectClips } from './select.js';

const clip = (videoId, duration) => ({ videoId, startTime: 100, endTime: 100 + duration, duration: 999 });
const split = { by: 'stream', minSec: 10 };
describe('stream split', () => {
  it('連続する配信をまとめ、短い塊を次へ、短い末尾を直前へ寄せる（duration値ではなくトリム尺）', () => {
    const clips = [clip('a', 3), clip('a', 4), clip('b', 5), clip('c', 11), clip('a', 2), clip('d', 3)];
    assert.deepEqual(splitClips(clips, split), [clips.slice(0, 3), clips.slice(3)]);
    assert.deepEqual(splitClips(clips), [clips]);
    assert.deepEqual(splitClips([], split), []);
    assert.deepEqual(splitClips([clip('a', 2), clip('b', 3)], split).map(p => p.length), [2]);
    assert.deepEqual(splitClips([clip('a', 10), clip('b', 10)], split).map(p => p.length), [1, 1]);
  });
  it('離れて再登場する同じ配信を合体させない', () => {
    assert.equal(splitClips([clip('a', 10), clip('b', 10), clip('a', 10)], split).length, 3);
  });
  it('出力は常に連番、part指定は元の番号を維持し範囲外を拒否', () => {
    assert.equal(partOutputPath('/tmp/name.mp4', 3), '/tmp/name-03.mp4');
    assert.equal(partOutputPath('/tmp/name', 1), '/tmp/name-01.mp4');
    const config = { output: { split }, __meta: { cli: { part: '2' } } };
    const clips = [clip('a', 10), clip('b', 10)];
    assert.deepEqual(selectParts(clips, config), [{ part: 2, clips: [clips[1]] }]);
    for (const value of ['0', '3', 'x', true, '1.5']) {
      assert.throws(() => selectParts(clips, { ...config, __meta: { cli: { part: value } } }), /--part/);
    }
    assert.throws(() => selectParts(clips, { ...config, output: { split: null } }), /--part/);
  });
  // 本数は public/data のクリップ追加で変わるので固定しない（2026-11-01 時点ではやられ 7 本・侍 23 本）。
  it('実データ（やられ・侍）を漏れなく分け、どのパートも minSec 以上になる', () => {
    for (const category of ['やられ', '侍']) {
      const config = loadConfig(['--config', 'scripts/create-video/config-shorts.json', '--category', category]);
      const clips = collectClips(config);
      const result = splitClips(clips, config.output.split);
      assert.deepEqual(result.flat(), clips);
      assert.ok(result.every((part) => part.reduce((sum, c) => sum + c.endTime - c.startTime, 0) >= config.output.split.minSec));
    }
  });
});
