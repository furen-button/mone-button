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
  it('qc.thresholds.clipDurationMs の既定値・上書き・不正値を検証する', () => {
    const load = (value) => loadConfig(['--config', writeTempConfig(value), '--videoId', 'abc123']);
    assert.equal(load({}).qc.thresholds.clipDurationMs, 250);
    assert.equal(load({ qc: { thresholds: { clipDurationMs: 100 } } }).qc.thresholds.clipDurationMs, 100);
    assert.throws(() => load({ qc: { thresholds: { clipDurationMs: 'invalid' } } }), /qc\.thresholds\.clipDurationMs/u);
  });

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

  it('summary.chapters.minSec は YouTube の要件の 10 秒以上だけを受け付ける', () => {
    const tooShort = writeTempConfig({ summary: { chapters: { minSec: 5 } } });
    assert.throws(() => loadConfig(['--config', tooShort, '--videoId', 'abc123']), /summary\.chapters\.minSec は 10 以上/u);
    const notNumber = writeTempConfig({ summary: { chapters: { minSec: 'ten' } } });
    assert.throws(() => loadConfig(['--config', notNumber, '--videoId', 'abc123']), /summary\.chapters\.minSec/u);
    const longer = writeTempConfig({ summary: { chapters: { minSec: 15 } } });
    assert.equal(loadConfig(['--config', longer, '--videoId', 'abc123']).summary.chapters.minSec, 15);
    assert.equal(loadConfig(['--config', writeTempConfig({}), '--videoId', 'abc123']).summary.chapters.minSec, 10);
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


describe('Shorts settings', () => {
  it('Shorts と既定の設定、CLI part を読み込む', () => {
    const shorts = loadConfig(['--config', 'scripts/create-video/config-shorts.json', '--part', '3']);
    assert.equal(shorts.effects.reframe.enabled, true);
    assert.equal(shorts.effects.reframe.frames, 3);
    assert.equal(shorts.effects.reframe.zoom, 1);
    assert.deepEqual(shorts.output.split, { by: 'stream', minSec: 10 });
    assert.equal(shorts.output.resolution, '1080x1920');
    assert.equal(shorts.__meta.cli.part, '3');
    const legacy = loadConfig(['--config', writeTempConfig({}), '--videoId', 'abc123']);
    assert.equal(legacy.effects.reframe.enabled, false);
    assert.equal(legacy.output.split, null);
    assert.equal(legacy.effects.reframe.pick, 'largest');
    assert.deepEqual(legacy.effects.reframe.target, { x: 0.5, y: 0.45 });
    assert.equal(legacy.effects.reframe.maxZoom, 3);
    assert.equal(legacy.effects.reframe.minFaceHeight, 0);
    assert.equal(legacy.telops.serif.layout, 'wrap');
    assert.equal(legacy.telops.title.layout, 'default');
    assert.equal(shorts.effects.reframe.pick, 'right');
    assert.equal(shorts.effects.reframe.maxZoom, 1.8);
    assert.deepEqual(shorts.effects.reframe.target, { x: 0.5, y: 0.46 });
    assert.equal(shorts.effects.reframe.minFaceHeight, 0.26);
    assert.equal(shorts.telops.title.layout, 'date-title');
    assert.equal(shorts.telops.serif.layout, 'space-lines');
    assert.equal(shorts.telops.serif.faceRange.enabled, true);
    assert.equal(shorts.telops.serif.marginH, 50 / 1080);
    assert.equal(shorts.telops.title.box.offsetY, 0);
    assert.equal(shorts.telops.title.box.anchor, 'bottom');
    assert.equal(legacy.telops.serif.faceRange.enabled, false);
  });
  it('faceRange とタイトルの anchor を検証する', () => {
    for (const faceRange of [{ top: -0.1 }, { maxHeight: 0.1 }, { minHeight: 0 }, { top: 0.9 }, { fallbackBottom: 0.01 }, { enabled: 'true' }]) {
      assert.throws(() => loadConfig(['--config', writeTempConfig({ telops: { serif: { faceRange } } }), '--videoId', 'abc123']), /faceRange/u);
    }
    assert.throws(() => loadConfig(['--config', writeTempConfig({ telops: { title: { box: { anchor: 'middle' } } } }), '--videoId', 'abc123']), /anchor/u);
  });

  it('不正な split/reframe を拒否する', () => {
    for (const split of [false, {}, { by: 'clip', minSec: 10 }, { by: 'stream', minSec: -1 }, { by: 'stream', minSec: '10' }]) {
      assert.throws(() => loadConfig(['--config', writeTempConfig({ output: { split } }), '--videoId', 'abc123']), /output.split/);
    }
    for (const reframe of [{ zoom: 0.9 }, { zoom: 4 }, { frames: 0 }, { frames: 1.5 }, { x: 2 }, { enabled: 'true' }, { pick: 'left' }, { fill: 'white' }, { target: { y: 0.6 } }, { target: { x: -0.1 } }, { maxZoom: 0.9 }, { maxZoom: 4 }, { minFaceHeight: -1 }, { minFaceHeight: 2 }]) {
      assert.throws(() => loadConfig(['--config', writeTempConfig({ effects: { reframe } }), '--videoId', 'abc123']), /effects.reframe/);
    }
  });
});

describe('camera の設定', () => {
  it('既定 true、CLI の kill switch、boolean 検証', () => {
    const file = writeTempConfig({ select: { videoId: 'abc123' } });
    assert.equal(loadConfig(['--config', file]).effects.camera.enabled, true);
    assert.equal(loadConfig(['--config', file, '--no-camera']).effects.camera.enabled, false);
    assert.throws(() => loadConfig(['--config', writeTempConfig({ effects: { camera: { enabled: 'bad' } } })]), /camera/u);
  });
});
