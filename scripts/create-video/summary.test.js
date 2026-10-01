import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildChapters,
  buildSources,
  chapterLabelFor,
  renderCommentList,
  renderYoutubeDescription,
  summaryPathsFor,
} from './summary.js';

function entry(atSec, videoId, title, serif = 'せりふ') {
  return {
    atSec,
    serif,
    videoId,
    title,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    uploadDate: '20240622',
    clipUrl: `https://youtube.com/watch?v=${videoId}&t=${atSec}s`,
  };
}

describe('chapterLabelFor', () => {
  it('先頭の【】を見出しに、末尾の【演者名】を落とす', () => {
    assert.equal(
      chapterLabelFor('【初配信】これはきっと運命の出会い【梢桃音/にじさんじ】'),
      '初配信 - これはきっと運命の出会い',
    );
  });

  it('先頭の【】しかないときはその中身だけを使う', () => {
    assert.equal(chapterLabelFor('【雑談】【梢桃音/にじさんじ】'), '雑談');
  });

  it('【】が無いタイトルはそのまま使う', () => {
    assert.equal(chapterLabelFor('ふつうのタイトル'), 'ふつうのタイトル');
  });
});

describe('buildChapters', () => {
  it('videoId の変わり目で切り、先頭は必ず 0:00 にする', () => {
    const entries = [
      entry(1.5, 'aaa', 'A'), entry(20, 'aaa', 'A'),
      entry(40, 'bbb', 'B'),
      entry(70, 'ccc', 'C'),
    ];
    const { chapters, warnings } = buildChapters(entries, 100);
    assert.deepEqual(warnings, []);
    assert.deepEqual(chapters.map((c) => [c.time, c.videoId]), [
      ['0:00', 'aaa'], ['0:40', 'bbb'], ['1:10', 'ccc'],
    ]);
  });

  it('10 秒未満の区間は直前へ吸収する', () => {
    const entries = [
      entry(0, 'aaa', 'A'),
      entry(30, 'bbb', 'B'),
      entry(33, 'ccc', 'C'),
      entry(60, 'ddd', 'D'),
    ];
    const { chapters } = buildChapters(entries, 100);
    // bbb は 30→33 秒の 3 秒しかないので直前の aaa に吸収される
    assert.deepEqual(chapters.map((c) => c.videoId), ['aaa', 'ccc', 'ddd']);
  });

  it('先頭が短いときは後続へ寄せたうえで 0:00 を保つ', () => {
    const entries = [
      entry(0, 'aaa', 'A'),
      entry(4, 'bbb', 'B'),
      entry(40, 'ccc', 'C'),
      entry(70, 'ddd', 'D'),
    ];
    const { chapters } = buildChapters(entries, 100);
    assert.equal(chapters[0].sec, 0);
    assert.equal(chapters[0].videoId, 'bbb');
  });

  it('最終チャプターの長さは総尺から測る', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B'), entry(60, 'ccc', 'C')];
    const short = buildChapters(entries, 63).chapters;
    // ccc が 3 秒しかないので bbb に吸収され、3 個未満になって省かれる
    assert.deepEqual(short, []);
    const enough = buildChapters(entries, 90).chapters;
    assert.equal(enough.length, 3);
  });

  it('3 個未満になったら警告してチャプターを省く', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B')];
    const { chapters, warnings } = buildChapters(entries, 60);
    assert.deepEqual(chapters, []);
    assert.equal(warnings.length, 1);
  });

  it('labels で videoId ごとに名前を上書きできる', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B'), entry(60, 'ccc', 'C')];
    const { chapters } = buildChapters(entries, 90, { labels: { bbb: '手書きの名前' } });
    assert.equal(chapters[1].label, '手書きの名前');
  });
});

describe('buildSources', () => {
  it('配信単位でまとめ、初出の順を保つ', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(10, 'bbb', 'B'), entry(20, 'aaa', 'A')];
    assert.deepEqual(buildSources(entries).map((s) => s.videoId), ['aaa', 'bbb']);
  });
});

describe('renderYoutubeDescription', () => {
  const chapters = [{ sec: 0, time: '0:00', label: 'A' }, { sec: 30, time: '0:30', label: 'B' }];
  const sources = [{ title: 'A の配信', url: 'https://example.test/a' }];

  it('設定が空の節は見出しごと落とす', () => {
    const text = renderYoutubeDescription({ chapters, sources, summary: {} });
    assert.ok(!text.includes('▼ボタンで遊べるサイト'));
    assert.ok(!text.includes('▼梢桃音さん 公式チャンネル'));
    assert.ok(!text.includes('null'));
    assert.ok(text.includes('▼チャプター'));
    assert.ok(text.includes('▼出典（配信一覧）'));
  });

  it('設定した URL と文言を出す', () => {
    const text = renderYoutubeDescription({
      chapters,
      sources,
      summary: {
        intro: 'どうも', notice: '※非公式', siteUrl: 'https://example.test/site',
        officialChannelUrl: 'https://example.test/ch', footer: ['#タグ'],
      },
    });
    assert.ok(text.startsWith('どうも\n※非公式'));
    assert.ok(text.includes('https://example.test/site'));
    assert.ok(text.trimEnd().endsWith('#タグ'));
  });

  it('チャプターが空なら節ごと出さない', () => {
    const text = renderYoutubeDescription({ chapters: [], sources, summary: {} });
    assert.ok(!text.includes('▼チャプター'));
  });
});

describe('renderCommentList', () => {
  const entries = Array.from({ length: 40 }, (_, i) => entry(i * 5, 'aaa', 'A', `せりふ${i}`));

  it('上限内なら 1 つにまとめる', () => {
    assert.equal(renderCommentList(entries, 5000).length, 1);
  });

  it('上限を超えたら空行の区切りで分割し、どの塊も上限に収まる', () => {
    const chunks = renderCommentList(entries, 600);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 600, `chunk が ${chunk.length} 文字`);
    }
  });

  it('分割しても取りこぼさない', () => {
    const chunks = renderCommentList(entries, 600);
    const joined = chunks.join('');
    for (const e of entries) {
      assert.ok(joined.includes(e.serif), `${e.serif} が欠落`);
    }
  });
});

describe('summaryPathsFor', () => {
  it('出力 mp4 と同じ場所に 3 系統を並べる', () => {
    const paths = summaryPathsFor('/tmp/out/matome-01.mp4');
    assert.equal(paths.youtube, '/tmp/out/matome-01.youtube.txt');
    assert.equal(paths.comment, '/tmp/out/matome-01.comment.txt');
    assert.equal(paths.meta, '/tmp/out/matome-01.meta.json');
  });
});

describe('chapterLabelFor の実データ変種', () => {
  it('末尾が 『』 表記の配信でも落とし、残った区切り記号も取る', () => {
    assert.equal(
      chapterLabelFor('#梢桃音3D お披露目 - 魔法のお守り-  『 にじさんじ / 梢桃音 』'),
      '#梢桃音3D お披露目 - 魔法のお守り',
    );
  });
});

describe('同じ配信が再登場するチャプター', () => {
  // 総集編は末尾に名場面を集めるため、既出の配信がもう一度チャプターになる。
  it('labels を "videoId#N" で出現回ごとに上書きできる', () => {
    const entries = [
      entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B'), entry(60, 'aaa', 'A'),
    ];
    const { chapters } = buildChapters(entries, 90, {
      labels: { 'aaa#2': 'フィナーレ' },
    });
    assert.deepEqual(chapters.map((c) => c.label), ['A', 'B', 'フィナーレ']);
    assert.deepEqual(chapters.map((c) => c.occurrence), [1, 1, 2]);
  });

  it('videoId 指定は全出現に効き、#N 指定が優先される', () => {
    const entries = [
      entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B'), entry(60, 'aaa', 'A'),
    ];
    const { chapters } = buildChapters(entries, 90, {
      labels: { aaa: '共通', 'aaa#2': '個別' },
    });
    assert.deepEqual(chapters.map((c) => c.label), ['共通', 'B', '個別']);
  });
});

describe('分割した固定コメントの出典', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({
    atSec: i * 5,
    serif: `せりふ${i}`,
    videoId: 'aaa',
    title: '配信タイトルA',
    clipUrl: `https://example.test/${i}`,
  }));

  it('どの塊も先頭に配信タイトルを出す', () => {
    const chunks = renderCommentList(entries, 400);
    assert.ok(chunks.length > 1);
    for (const [i, chunk] of chunks.entries()) {
      const firstBlock = chunk.split('\n\n')[0].split('\n');
      assert.equal(firstBlock[1], '配信タイトルA', `chunk${i + 1} に出典が無い`);
    }
  });

  it('先頭へタイトルを足しても上限を超えない', () => {
    for (const limit of [300, 400, 700]) {
      for (const chunk of renderCommentList(entries, limit)) {
        assert.ok(chunk.length <= limit, `limit=${limit} で ${chunk.length} 文字`);
      }
    }
  });

  it('途中の同じ配信ではタイトルを繰り返さない', () => {
    const [chunk] = renderCommentList(entries, 100000);
    assert.equal(chunk.split('配信タイトルA').length - 1, 1);
  });
});
