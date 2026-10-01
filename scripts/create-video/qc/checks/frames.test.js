import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseBlackDetect, parseFreezeDetect, runFrameLogChecks } from './frames.js';

const freezeLog = `
[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 0
[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 1.5
[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 1.5
[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 4
[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 1.2
[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 5.2
`;

const config = { qc: { thresholds: { blackMinDuration: 0.5, freezeMinDuration: 0.5 } } };

describe('frame log parsers', () => {
  it('blackdetect の区間を読む', () => {
    const parsed = parseBlackDetect('[blackdetect @ 0x123] black_start:1.2 black_end:1.9 black_duration:0.7');
    assert.deepEqual(parsed, [{ start: 1.2, end: 1.9, duration: 0.7 }]);
  });

  it('freezedetect の別行区間を読む', () => {
    const parsed = parseFreezeDetect(`
[freezedetect @ 0x123] lavfi.freezedetect.freeze_start: 2
[freezedetect @ 0x123] lavfi.freezedetect.freeze_duration: 0.6
[freezedetect @ 0x123] lavfi.freezedetect.freeze_end: 2.6
`);
    assert.deepEqual(parsed, [{ start: 2, end: 2.6, duration: 0.6 }]);
  });
});

describe('フリーズ検出の区間スコープ', () => {
  // 区切りカード・OP・ED は静止画背景なので止まっているのが設計どおり。
  it('manifest があればカード区間のフリーズを無視する', () => {
    const manifest = {
      segments: [
        { kind: 'opening', base: 'opening', atSec: 0, durationSec: 3 },
        { kind: 'clip', base: 'clip-a', atSec: 3, durationSec: 3 },
      ],
    };
    const results = runFrameLogChecks({ scanLog: freezeLog, manifest, config });
    const codes = results.map((item) => item.code);
    assert.deepEqual(codes, ['frames_freeze_in_clip']);
    assert.match(results[0].message, /clip-a/u);
  });

  it('manifest が無ければ区間を問わず warn にする', () => {
    const results = runFrameLogChecks({ scanLog: freezeLog, manifest: null, config });
    assert.deepEqual(results.map((item) => item.code), ['frames_freeze_detected', 'frames_freeze_detected']);
  });
});
