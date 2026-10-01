import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildArgv, qcArgv } from './build-options.js';

describe('buildArgv', () => {
  it('allowlist のオプションだけを createVideo の argv に変換する', () => {
    assert.deepEqual(
      buildArgv('config.json', { limit: 2, qc: true, contact: true, source: 'cache' }),
      ['--config', 'scripts/create-video/config.json', '--limit', '2', '--qc', '--contact', '--source', 'cache'],
    );
    assert.deepEqual(buildArgv('config-mone.json', { contact: true }).slice(2), ['--qc', '--contact']);
    // bool フラグは定義順（cards → bgm → zoom → … → avoid-face）で並ぶ
    assert.deepEqual(buildArgv('config-mone.json', { cards: false, avoidFace: false, zoom: true }).slice(2), ['--no-cards', '--zoom', '--no-avoid-face']);
    assert.deepEqual(buildArgv('config-mone.json', { titleText: '上段\\n下段', out: 'test.mp4' }).slice(2), ['--title', '上段\\n下段', '--out', 'output/test.mp4']);
  });

  it('不正な値・未知のキー・パスを拒否する', () => {
    assert.throws(() => buildArgv('config.json', { limit: '1; rm -rf /' }), /limit/u);
    assert.throws(() => buildArgv('config.json', { argv: ['--foo'] }), /unknown build option/u);
    assert.throws(() => buildArgv('config.json', { out: '../x.mp4' }), /out/u);
    assert.throws(() => buildArgv('config.json', { out: 'x.mkv' }), /out/u);
    assert.throws(() => buildArgv('config.json', { source: 'youtube' }), /source/u);
    assert.throws(() => buildArgv('config.json', { cards: 'yes' }), /cards/u);
    assert.throws(() => buildArgv('config.json', { resolution: '1920×1080' }), /resolution/u);
    assert.throws(() => buildArgv('../config.json', {}), /preset/u);
  });
});

describe('qcArgv', () => {
  it('output 配下の mp4 とプリセットを指す', () => {
    assert.deepEqual(qcArgv('config-mone.json', 'eval-1-default', { contact: true }), [
      '--video', 'output/eval-1-default.mp4', '--config', 'scripts/create-video/config-mone.json', '--contact',
    ]);
    assert.throws(() => qcArgv('config.json', '../x'), /video/u);
  });
});
