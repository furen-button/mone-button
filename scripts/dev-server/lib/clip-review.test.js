import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACKNOWLEDGEABLE_KINDS,
  ISSUE_KINDS,
  MAX_RUN_UNITS,
  findInvalidRubyChars,
  findLongSerifRuns,
  isUntrimmedImportWindow,
  normalizeReview,
  reviewClip,
  splitSerifTokens,
  summarizeReviews,
} from './clip-review.js';

function clip(overrides = {}) {
  return {
    videoId: 'abc_123',
    serif: 'てすと',
    ruby: 'てすと',
    categories: ['テスト'],
    clipUrl: 'https://youtube.com/watch?v=abc_123&t=100s',
    memo: '',
    trimming: { startTime: 100, endTime: 104, duration: 4 },
    videoFile: { metadata: { title: 'test' } },
    ...overrides,
  };
}

function importWindow(overrides = {}) {
  return clip({
    serif: 'ｲｷﾞｬｰﾘ！',
    ruby: 'ｲｷﾞｬｰﾘ！',
    trimming: { startTime: 114, endTime: 144, duration: 30 },
    ...overrides,
  });
}

describe('findInvalidRubyChars', () => {
  it('ひらがな・長音・数字・英字だけなら空', () => {
    assert.deepEqual(findInvalidRubyChars(''), []);
    assert.deepEqual(findInvalidRubyChars('あいうえおゔゝゞー'), []);
    assert.deepEqual(findInvalidRubyChars('DVさむらい'), []);
    assert.deepEqual(findInvalidRubyChars('1000ねんいじょう'), []);
    assert.deepEqual(findInvalidRubyChars('１２のぽかん'), []);
  });

  it('半角カナ・カタカナ・漢字・記号を重複なく列挙する', () => {
    assert.deepEqual(findInvalidRubyChars('ｲｷﾞｬｰﾘ！'), ['ｲ', 'ｷ', 'ﾞ', 'ｬ', 'ｰ', 'ﾘ', '！']);
    assert.deepEqual(findInvalidRubyChars('イギャーリ'), ['イ', 'ギ', 'ャ', 'リ']);
    assert.deepEqual(findInvalidRubyChars('あさから梢桃音'), ['梢', '桃', '音']);
    assert.deepEqual(findInvalidRubyChars('わたし？いま？'), ['？']);
    assert.deepEqual(findInvalidRubyChars('さん っ！'), [' ', '！']);
  });
});

describe('findLongSerifRuns', () => {
  it(`半角スペース無しで ${MAX_RUN_UNITS} 字を超える区間だけを返す`, () => {
    assert.deepEqual(findLongSerifRuns('あ'.repeat(MAX_RUN_UNITS)), []);
    assert.deepEqual(findLongSerifRuns('あ'.repeat(MAX_RUN_UNITS + 1)), [
      { text: 'あ'.repeat(MAX_RUN_UNITS + 1), units: MAX_RUN_UNITS + 1 },
    ]);
    assert.deepEqual(findLongSerifRuns(`${'あ'.repeat(10)} ${'い'.repeat(10)}`), []);
  });

  it('改行で区切り、半角は 0.5 字、強調記法と絵文字は数えない', () => {
    assert.deepEqual(findLongSerifRuns(`${'あ'.repeat(10)}\n${'い'.repeat(10)}`), []);
    assert.deepEqual(findLongSerifRuns('a'.repeat(30)), []);
    assert.deepEqual(findLongSerifRuns('a'.repeat(31)).map((run) => run.units), [15.5]);
    assert.deepEqual(findLongSerifRuns(`{${'あ'.repeat(8)}|FF0000}${'い'.repeat(7)}`), []);
    assert.deepEqual(findLongSerifRuns(`${'あ'.repeat(15)}🍄🌟`), []);
    assert.deepEqual(splitSerifTokens('あい うえ\nおか'), ['あい', ' ', 'うえ', '\n', 'おか']);
  });
});

describe('isUntrimmedImportWindow', () => {
  it('original が無く長さが 30 秒のときだけ true', () => {
    assert.equal(isUntrimmedImportWindow(importWindow()), true);
    assert.equal(isUntrimmedImportWindow(importWindow({ trimming: { startTime: 0, endTime: 30.03, duration: 30.03 } })), true);
    assert.equal(isUntrimmedImportWindow(importWindow({ trimming: { startTime: 0, endTime: 29.9, duration: 29.9 } })), false);
    assert.equal(isUntrimmedImportWindow(clip()), false);
    assert.equal(isUntrimmedImportWindow(importWindow({
      trimming: { startTime: 114.5, endTime: 144.5, duration: 30, original: { startTime: 114, endTime: 144, duration: 30 } },
    })), false);
  });

  it('壊れたデータでは false', () => {
    assert.equal(isUntrimmedImportWindow(null), false);
    assert.equal(isUntrimmedImportWindow({}), false);
    assert.equal(isUntrimmedImportWindow({ trimming: { duration: 'thirty' } }), false);
  });
});

describe('normalizeReview', () => {
  it('object 以外・空・未知のキーは undefined', () => {
    assert.equal(normalizeReview(undefined, clip()), undefined);
    assert.equal(normalizeReview('yes', clip()), undefined);
    assert.equal(normalizeReview({}, clip()), undefined);
    assert.equal(normalizeReview({ categories: true, trim: 'yes' }, clip()), undefined);
  });

  it('trim は切っていない間だけ残す', () => {
    assert.deepEqual(normalizeReview({ trim: true }, importWindow()), { trim: true });
    assert.equal(normalizeReview({ trim: true }, clip()), undefined);
  });

  it('ruby / serif は今の値と同じときだけ残す', () => {
    const data = importWindow();
    assert.deepEqual(normalizeReview({ ruby: 'ｲｷﾞｬｰﾘ！', serif: 'ｲｷﾞｬｰﾘ！' }, data), { ruby: 'ｲｷﾞｬｰﾘ！', serif: 'ｲｷﾞｬｰﾘ！' });
    assert.deepEqual(normalizeReview({ ruby: 'ｲｷﾞｬｰﾘ！', serif: 'ちがう' }, data), { ruby: 'ｲｷﾞｬｰﾘ！' });
    assert.equal(normalizeReview({ ruby: 'いぎゃーり' }, data), undefined);
  });
});

describe('reviewClip', () => {
  it('未 DL・未カット・ルビ不正を表示順で返す', () => {
    const result = reviewClip(importWindow(), { hasVideo: false });
    assert.deepEqual(result.issues.map((issue) => issue.kind), ['video', 'trim', 'ruby']);
    assert.deepEqual(result.acknowledged, []);
    assert.match(result.issues[0].message, /npm run download/u);
    assert.match(result.issues[1].message, /30 秒/u);
    assert.match(result.issues[2].message, /ｲ ｷ ﾞ ｬ ｰ ﾘ ！/u);
  });

  it('動画の有無が未確認なら video を出さず、問題が無ければ空', () => {
    assert.deepEqual(reviewClip(importWindow()).issues.map((issue) => issue.kind), ['trim', 'ruby']);
    assert.deepEqual(reviewClip(clip(), { hasVideo: true }), { issues: [], acknowledged: [] });
  });

  it('ruby が空・serif の長い区間も要対応', () => {
    assert.deepEqual(reviewClip(clip({ ruby: '' })).issues.map((issue) => issue.kind), ['ruby']);
    const long = reviewClip(clip({ serif: 'およめさんにしてくださいおよめさんにしてください' }));
    assert.deepEqual(long.issues.map((issue) => issue.kind), ['serif']);
    assert.match(long.issues[0].message, /24 字/u);
  });

  it('review で確認済みの種類は issues から外れ acknowledged に入る', () => {
    const data = importWindow({ review: { trim: true, ruby: 'ｲｷﾞｬｰﾘ！' } });
    const result = reviewClip(data, { hasVideo: true });
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.acknowledged, ['trim', 'ruby']);
  });

  it('確認したときと値が違えば確認は効かない', () => {
    const data = importWindow({ ruby: 'ｲｷﾞｬｰﾘ', review: { ruby: 'ｲｷﾞｬｰﾘ！' } });
    assert.deepEqual(reviewClip(data, { hasVideo: true }).issues.map((issue) => issue.kind), ['trim', 'ruby']);
  });

  it('種類の定義が揃っている', () => {
    assert.deepEqual([...ISSUE_KINDS], ['video', 'trim', 'ruby', 'serif']);
    assert.deepEqual([...ACKNOWLEDGEABLE_KINDS], ['trim', 'ruby', 'serif']);
  });
});

describe('summarizeReviews', () => {
  it('要対応のあるクリップ数と種類ごとの件数を数える', () => {
    const summary = summarizeReviews([
      reviewClip(importWindow(), { hasVideo: false }),
      reviewClip(importWindow(), { hasVideo: true }),
      reviewClip(clip(), { hasVideo: true }),
    ]);
    assert.deepEqual(summary, { total: 2, counts: { video: 1, trim: 2, ruby: 2, serif: 0 } });
  });
});
