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

  it('--enhance と --no-zoom は effects を互いに潰さない', () => {
    const config = writeTempConfig({});
    const loaded = loadConfig(['--config', config, '--videoId', 'abc123', '--enhance', '--no-zoom']);
    assert.equal(loaded.effects.enhance.enabled, true);
    assert.equal(loaded.effects.zoom.enabled, false);
    assert.equal(loaded.effects.enhance.restore, 'Restore_CNN_M');
    assert.equal(loaded.__meta.cli.enhance, true);
  });

  it('--no-enhance は設定より優先し、kill switch として __meta.cli に残る', () => {
    const config = writeTempConfig({ effects: { enhance: { enabled: true } } });
    const loaded = loadConfig(['--config', config, '--videoId', 'abc123', '--no-enhance']);
    assert.equal(loaded.effects.enhance.enabled, false);
    assert.equal(loaded.__meta.cli.enhance, false);
  });

  it('effects.enhance の backend とシェーダ名を検証する', () => {
    const badBackend = writeTempConfig({ effects: { enhance: { backend: 'realesrgan' } } });
    assert.throws(() => loadConfig(['--config', badBackend, '--videoId', 'abc123']), /effects\.enhance\.backend/u);
    const badName = writeTempConfig({ effects: { enhance: { restore: 'Restore CNN M; rm -rf' } } });
    assert.throws(() => loadConfig(['--config', badName, '--videoId', 'abc123']), /effects\.enhance\.restore/u);
    const nullRestore = writeTempConfig({ effects: { enhance: { restore: null, minSourceHeight: 1080 } } });
    assert.equal(loadConfig(['--config', nullRestore, '--videoId', 'abc123']).effects.enhance.restore, null);
  });
});
