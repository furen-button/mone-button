import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLineSplitter, parseLogLine, stripAnsi } from './log-parser.js';

describe('parseLogLine', () => {
  it('進捗・完成・concat・sidecar・QC 集計を分類する', () => {
    assert.deepEqual(parseLogLine('🎬 [3/79] 描画中: 2024-07-13-gr9WJDYS_u0-000104-000106'), {
      kind: 'progress', i: 3, n: 79, base: '2024-07-13-gr9WJDYS_u0-000104-000106',
    });
    assert.deepEqual(parseLogLine('🚀 videoId="x" のクリップ 3 件をまとめ動画にします（source=existing）'), { kind: 'stage', name: 'render' });
    assert.deepEqual(parseLogLine('🔗 9 セグメントを連結中...'), { kind: 'stage', name: 'concat' });
    assert.deepEqual(parseLogLine('🎧 BGM をミックス中...'), { kind: 'stage', name: 'bgm' });
    assert.deepEqual(parseLogLine('✅ 完成: /abs/output/x.mp4'), { kind: 'done', outPath: '/abs/output/x.mp4' });
    assert.deepEqual(parseLogLine('   concat: concat-vcopy'), { kind: 'concat', method: 'concat-vcopy' });
    assert.deepEqual(parseLogLine('🧾 output/x.render.json'), { kind: 'sidecar', stage: 'manifest', path: 'output/x.render.json' });
    assert.deepEqual(parseLogLine('📝 output/x.youtube.txt'), { kind: 'sidecar', stage: 'summary', path: 'output/x.youtube.txt' });
    assert.deepEqual(parseLogLine('🧪 QC: error 0 / warn 3 / info 5'), { kind: 'qc', error: 0, warn: 3, info: 5 });
    assert.equal(parseLogLine('frame= 1038 fps=0.0 q=-1.0'), null);
  });

  it('ANSI エスケープを落として判定する', () => {
    assert.equal(stripAnsi('[32m✅ 完成: x[0m'), '✅ 完成: x');
    assert.deepEqual(parseLogLine('[1m🎬 [1/2] 描画中: a[0m'), { kind: 'progress', i: 1, n: 2, base: 'a' });
  });
});

describe('createLineSplitter', () => {
  it('チャンク境界で割れた行を繋ぎ、CRLF も 1 行にする', () => {
    const lines = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('🎬 [1/2] 描');
    splitter.push('画中: a\r\n✅ 完成: /x.mp4\n   con');
    splitter.push('cat: concat-vcopy');
    assert.deepEqual(lines, ['🎬 [1/2] 描画中: a', '✅ 完成: /x.mp4']);
    splitter.flush();
    assert.deepEqual(lines.at(-1), '   concat: concat-vcopy');
  });
});
