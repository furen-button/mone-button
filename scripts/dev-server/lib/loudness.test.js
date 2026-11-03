import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loudnessGain, parseEbur128Summary, volumeFilter } from './loudness.js';

const SUMMARY = `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -13.3 LUFS
    Threshold: -23.3 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:       -5.5 dBFS
`;

describe('parseEbur128Summary', () => {
  it('Summary の integrated loudness と true peak を読む', () => {
    assert.deepEqual(parseEbur128Summary(`frame lines...\n${SUMMARY}`), { integrated: -13.3, truePeak: -5.5 });
  });

  it('無音の -inf と Summary の無い出力は null', () => {
    assert.deepEqual(
      parseEbur128Summary(SUMMARY.replace('-13.3 LUFS', '-70.0 LUFS').replace('-5.5 dBFS', '-inf dBFS')),
      { integrated: -70, truePeak: null },
    );
    assert.deepEqual(parseEbur128Summary('error'), { integrated: null, truePeak: null });
  });
});

describe('loudnessGain', () => {
  it('大きすぎる区間は目標まで下げる', () => {
    assert.deepEqual(loudnessGain({ integrated: -13.3, truePeak: -5.5 }), { gainDb: -9.7, reason: 'target' });
  });

  it('小さすぎる区間は true peak に余裕があれば目標まで上げる', () => {
    assert.deepEqual(loudnessGain({ integrated: -41, truePeak: -27.2 }), { gainDb: 18, reason: 'target' });
  });

  it('上げると true peak が -2 dBTP を超えるときはそこで止める', () => {
    assert.deepEqual(loudnessGain({ integrated: -27, truePeak: -5 }), { gainDb: 3, reason: 'peak' });
    // 既に上限を超えているときは上げも下げもしない。
    assert.deepEqual(loudnessGain({ integrated: -27, truePeak: -1 }), { gainDb: 0, reason: 'peak' });
  });

  it('測れない区間（無音・ゲート未満）は触らない', () => {
    assert.deepEqual(loudnessGain({ integrated: -70, truePeak: null }), { gainDb: 0, reason: 'unmeasurable' });
    assert.deepEqual(loudnessGain({ integrated: null, truePeak: null }), { gainDb: 0, reason: 'unmeasurable' });
  });
});

describe('volumeFilter', () => {
  it('ほぼ 0 dB なら足さない', () => {
    assert.equal(volumeFilter(0.02), null);
    assert.equal(volumeFilter(-9.7), 'volume=-9.70dB');
  });
});
