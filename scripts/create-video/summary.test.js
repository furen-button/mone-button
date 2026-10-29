import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildChapters,
  buildClipSources,
  buildMeta,
  buildSources,
  buildSummaryEntry,
  chapterLabelFor,
  renderCommentList,
  renderYoutubeDescription,
  summaryPathsFor,
} from './summary.js';

function entry(atSec, videoId, title, serif = 'せりふ') {
  return {
    atSec,
    base: `${videoId}-${atSec}`,
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

describe('buildChapters（by: stream）', () => {
  const stream = { by: 'stream' };

  it('videoId の変わり目で切り、先頭は必ず 0:00 にする', () => {
    const entries = [
      entry(1.5, 'aaa', 'A'), entry(20, 'aaa', 'A'),
      entry(40, 'bbb', 'B'),
      entry(70, 'ccc', 'C'),
    ];
    const { chapters, warnings } = buildChapters(entries, 100, stream);
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
    const { chapters } = buildChapters(entries, 100, stream);
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
    const { chapters } = buildChapters(entries, 100, stream);
    assert.equal(chapters[0].sec, 0);
    assert.equal(chapters[0].videoId, 'bbb');
  });

  it('最終チャプターの長さは総尺から測る', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B'), entry(60, 'ccc', 'C')];
    const short = buildChapters(entries, 63, stream).chapters;
    // ccc が 3 秒しかないので bbb に吸収され、3 個未満になって省かれる
    assert.deepEqual(short, []);
    const enough = buildChapters(entries, 90, stream).chapters;
    assert.equal(enough.length, 3);
  });

  it('3 個未満になったら警告してチャプターを省く', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B')];
    const { chapters, warnings } = buildChapters(entries, 60, stream);
    assert.deepEqual(chapters, []);
    assert.equal(warnings.length, 1);
  });

  it('labels で videoId ごとに名前を上書きできる', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(30, 'bbb', 'B'), entry(60, 'ccc', 'C')];
    const { chapters } = buildChapters(entries, 90, { ...stream, labels: { bbb: '手書きの名前' } });
    assert.equal(chapters[1].label, '手書きの名前');
  });
});

describe('buildChapters（by: clip、既定）', () => {
  it('セリフごとに切り、10 秒未満は前から順にまとめて見出しを「 / 」でつなぐ', () => {
    const entries = [
      entry(1.5, 'aaa', 'A', 'いち'), entry(5, 'aaa', 'A', 'に'), entry(15, 'aaa', 'A', 'さん'),
      entry(30, 'bbb', 'B', 'よん'), entry(33, 'bbb', 'B', 'ご'), entry(45, 'ccc', 'C', 'ろく'),
    ];
    const { chapters, warnings } = buildChapters(entries, 60);
    // 先頭は 0:00 から測るので、いち（0〜5 秒）は に と合わせて 15 秒になる。
    assert.deepEqual(warnings, []);
    assert.deepEqual(chapters.map((c) => [c.time, c.label]), [
      ['0:00', 'いち / に'], ['0:15', 'さん'], ['0:30', 'よん / ご'], ['0:45', 'ろく'],
    ]);
  });

  it('末尾だけ短く残ったら直前へ寄せる', () => {
    const entries = [
      entry(0, 'aaa', 'A', 'いち'), entry(12, 'aaa', 'A', 'に'),
      entry(24, 'bbb', 'B', 'さん'), entry(36, 'bbb', 'B', 'よん'),
    ];
    const { chapters } = buildChapters(entries, 40);
    assert.deepEqual(chapters.map((c) => c.label), ['いち', 'に', 'さん / よん']);
  });

  it('出典用にクリップ名と URL を持ち、labels はチャプター先頭のクリップ名で見出しを上書きする', () => {
    const entries = [entry(0, 'aaa', 'A', 'いち'), entry(5, 'aaa', 'A', 'に'), entry(12, 'bbb', 'B'), entry(30, 'ccc', 'C')];
    const { chapters } = buildChapters(entries, 45, { labels: { 'bbb-12': '手書きの名前' } });
    assert.deepEqual(chapters[0].bases, ['aaa-0', 'aaa-5']);
    assert.deepEqual(chapters[0].urls, ['https://youtube.com/watch?v=aaa&t=0s', 'https://youtube.com/watch?v=aaa&t=5s']);
    assert.equal(chapters[1].label, '手書きの名前');
  });

  it('セリフが空のクリップだけのチャプターは配信タイトルから見出しを作る', () => {
    const entries = [
      entry(0, 'aaa', '【雑談】ほげ【梢桃音/にじさんじ】', ''), entry(15, 'bbb', 'B'), entry(30, 'ccc', 'C'),
    ];
    assert.equal(buildChapters(entries, 45).chapters[0].label, '雑談 - ほげ');
  });
});

describe('buildClipSources', () => {
  it('チャプターと同じまとまりで URL を並べ、チャプターが 3 個未満で省かれても出典は残す', () => {
    const entries = [entry(0, 'aaa', 'A', 'いち'), entry(4, 'aaa', 'A', 'に'), entry(15, 'bbb', 'B', 'さん')];
    assert.deepEqual(buildChapters(entries, 30).chapters, []);
    assert.deepEqual(buildClipSources(entries, 30), [
      { label: 'いち / に', urls: ['https://youtube.com/watch?v=aaa&t=0s', 'https://youtube.com/watch?v=aaa&t=4s'] },
      { label: 'さん', urls: ['https://youtube.com/watch?v=bbb&t=15s'] },
    ]);
  });
});

describe('buildMeta のチャプター', () => {
  it('by: clip のチャプターはクリップ名と出典 URL も残す', () => {
    const entries = [entry(0, 'aaa', 'A'), entry(15, 'bbb', 'B'), entry(30, 'ccc', 'C')];
    const { chapters } = buildChapters(entries, 45);
    const meta = buildMeta({ entries, chapters, sources: [], summary: {}, totalSec: 45, videoOutPath: '/tmp/x.mp4' });
    assert.deepEqual(meta.chapters[1], {
      sec: 15, time: '0:15', label: 'せりふ', bases: ['bbb-15'], urls: ['https://youtube.com/watch?v=bbb&t=15s'],
    });
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

  it('clipSources があればチャプターごとに見出しと URL を並べ、配信一覧は出さない', () => {
    const clipSources = [
      { label: 'いち / に', urls: ['https://example.test/1', 'https://example.test/2'] },
      { label: 'さん', urls: ['https://example.test/3'] },
    ];
    const text = renderYoutubeDescription({ chapters, sources, clipSources, summary: {} });
    assert.ok(text.includes('▼出典\nいち / に\nhttps://example.test/1\nhttps://example.test/2\n\nさん\nhttps://example.test/3'));
    assert.ok(!text.includes('▼出典（配信一覧）'));
    // 出典の見出しに時刻を付けると、YouTube がそれもチャプターとして読み取ってしまう。
    const sourceLines = text.split('▼出典\n')[1].split('\n');
    assert.ok(sourceLines.every((line) => !/^\d+:\d{2}/.test(line)));
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
      by: 'stream',
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
      by: 'stream',
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

describe('buildSummaryEntry の強調記法', () => {
  it('serif の {語} / {語|RRGGBB} は記号を落として固定コメントに出す', () => {
    const clip = {
      videoId: 'abc',
      startTime: 12,
      meta: { title: '配信', uploadDate: '20240622' },
      data: { serif: 'なんか{キャサリン}が今\n{すごい|9B59D0}気に' },
    };
    assert.equal(buildSummaryEntry(clip, 0).serif, 'なんかキャサリンが今 すごい気に');
  });
});
