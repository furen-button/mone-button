import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gatedLoudness, parseEbur128, parseSilenceDetect } from './loudness.js';

describe('loudness parsers', () => {
  it('ebur128 の時系列・Integrated LUFS・True Peak を読む', () => {
    const parsed = parseEbur128(`
[Parsed_ebur128_1 @ 0x123] t: 0.0999773 TARGET:-23 LUFS    M: -20.1 S:-120.7     I: -20.1 LUFS       LRA:   0.0 LU  FTPK: -3.0 -3.1 dBFS  TPK: -3.0 -3.1 dBFS
[Parsed_ebur128_1 @ 0x123] Summary:

  Integrated loudness:
    I:         -14.2 LUFS

  True peak:
    Peak:       -0.8 dBFS
`);
    assert.equal(parsed.samples.length, 1);
    assert.equal(parsed.samples[0].m, -20.1);
    assert.equal(parsed.integratedLufs, -14.2);
    assert.equal(parsed.truePeak, -0.8);
  });

  it('silencedetect の開始・終了・長さを読む', () => {
    const parsed = parseSilenceDetect(`
[silencedetect @ 0x123] silence_start: 10.4
[silencedetect @ 0x123] silence_end: 11.25 | silence_duration: 0.85
`);
    assert.deepEqual(parsed, [{ start: 10.4, end: 11.25, duration: 0.85 }]);
  });
});

describe('gatedLoudness', () => {
  // クリップ内の間や小声に引っ張られると、実測 3.8 LU の差が 13.0 LU に化けていた。
  it('無音を含んでも喋っている区間のレベルを返す', () => {
    const speech = [-23, -23, -23, -23];
    const withSilence = [...speech, -70, -80, -120, -120];
    assert.ok(Math.abs(gatedLoudness(withSilence) - gatedLoudness(speech)) < 0.5);
  });

  it('dB 単純平均より高く出る（静かな部分に引っ張られない）', () => {
    const values = [-20, -20, -45, -45];
    const plainAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(gatedLoudness(values) > plainAverage);
  });

  it('全部が可聴域未満なら NaN', () => {
    assert.ok(Number.isNaN(gatedLoudness([-120, -90, -70])));
  });
});
