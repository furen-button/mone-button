import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { loadConfig } from './config.js';

function writeTempConfig(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-video-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

describe('loadConfig', () => {
  it('telops.title.overrides は文字列値だけを受け付ける', () => {
    const valid = writeTempConfig({
      telops: { title: { overrides: { abc123: '手動\nタイトル' } } },
    });
    assert.equal(loadConfig(['--config', valid, '--videoId', 'abc123']).telops.title.overrides.abc123, '手動\nタイトル');

    const invalid = writeTempConfig({
      telops: { title: { overrides: { abc123: 123 } } },
    });
    assert.throws(
      () => loadConfig(['--config', invalid, '--videoId', 'abc123']),
      /telops\.title\.overrides\.abc123 は文字列/u,
    );
  });

  it('--title の \\n エスケープを改行として受け取る', () => {
    const config = writeTempConfig({});
    assert.equal(loadConfig(['--config', config, '--videoId', 'abc123', '--title', '上段\\n下段']).titleOverride, '上段\n下段');
  });
});
