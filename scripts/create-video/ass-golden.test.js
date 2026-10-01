import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ASS_GOLDEN_NOTE,
  ASS_GOLDEN_VERSION,
  buildAssGoldenFixture,
  compareAssGoldenFixture,
} from './golden-ass.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '__fixtures__', 'ass-golden.json');

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b, 'ja'));
}

describe('ASS ゴールデン', () => {
  it('fixture のメタ情報とキー順が安定している', () => {
    const expected = loadFixture();
    assert.equal(expected.version, ASS_GOLDEN_VERSION);
    assert.equal(expected.note, ASS_GOLDEN_NOTE);
    assert.equal('generatedAt' in expected, false);
    assert.equal(expected.curated.length, 15);
    assert.equal(Object.keys(expected.full).length, expected.curated.length);
    assert.deepEqual(expected.curated, sorted(expected.curated));
    assert.deepEqual(Object.keys(expected.hashes), sorted(Object.keys(expected.hashes)));
    assert.deepEqual(Object.keys(expected.full), sorted(Object.keys(expected.full)));
  });

  it('3 プリセット × public/data 全クリップの buildClipElements → buildAss 出力が一致する', () => {
    const expected = loadFixture();
    const actual = buildAssGoldenFixture();
    const comparison = compareAssGoldenFixture(expected, actual);
    if (!comparison.ok) {
      assert.fail(`${comparison.message}\n意図した変更なら npm run golden:ass で fixture を更新してください。`);
    }
  });
});
