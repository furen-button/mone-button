import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TOLERANCE_LU, parseArgs, planFixes } from './fix-clip-loudness.js';

describe('parseArgs', () => {
  it('既定は全件・±2 LU・書き換えあり', () => {
    assert.deepEqual(parseArgs([]), { dryRun: false, toleranceLu: DEFAULT_TOLERANCE_LU, only: null });
  });

  it('--only はカンマ区切りと繰り返し指定をまとめる', () => {
    const options = parseArgs(['--dry-run', '--tolerance', '3', '--only', 'a-1, b_2', '--only', 'c']);
    assert.deepEqual(options, { dryRun: true, toleranceLu: 3, only: ['a-1', 'b_2', 'c'] });
  });

  it('不正な値は日本語のエラーにする', () => {
    assert.throws(() => parseArgs(['--tolerance', '-1']), /--tolerance/);
    assert.throws(() => parseArgs(['--only', '']), /--only/);
    assert.throws(() => parseArgs(['--only', '../x']), /クリップ名が不正/);
    assert.throws(() => parseArgs(['--force']), /不明なオプション/);
  });
});

describe('planFixes', () => {
  it('許容内は対象外、外れたものはずれの大きい順', () => {
    const { targets, skipped } = planFixes([
      { base: 'ok', integrated: -22.0, truePeak: -8 },
      { base: 'loud', integrated: -13.3, truePeak: -5.5 },
      { base: 'quiet', integrated: -26.0, truePeak: -12 },
    ], 2);
    assert.deepEqual(targets.map((t) => [t.base, t.gainDb, t.reason]), [['loud', -9.7, 'target'], ['quiet', 3, 'target']]);
    assert.deepEqual(skipped, []);
  });

  it('true peak に余裕が無く上げられないもの・測れないものは skipped', () => {
    const { targets, skipped } = planFixes([
      { base: 'peaky', integrated: -27, truePeak: -1.5 },
      { base: 'silent', integrated: -70, truePeak: null },
      { base: 'broken', integrated: null, truePeak: null },
    ], 2);
    assert.deepEqual(targets, []);
    assert.deepEqual(skipped.map((s) => [s.base, s.reason]), [['silent', 'unmeasurable'], ['peaky', 'peak']]);
  });
});
