import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { loadConfig, projectRoot, resolveProjectPath } from './config.js';
import { readEndcardAss } from './endcard-ass.js';

it('ED 動画が存在しても同じ土台の ASS を取得し、元の設定と相対パスを保つ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endcard-ass-'));
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/create-video/config-kirinuki.json'), 'utf8'));
    delete config.endcaps.ending.video;
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config));
    const expected = execFileSync(process.execPath, [
      path.join(projectRoot, 'scripts/create-video/preview.js'),
      '--config', configPath, '--still', 'ending', '--print-ass',
    ], { cwd: projectRoot, encoding: 'utf8' });
    config.endcaps.ending.video = 'package.json';
    fs.writeFileSync(configPath, JSON.stringify(config));
    const original = fs.readFileSync(configPath, 'utf8');
    assert.equal(readEndcardAss(configPath, dir), expected);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(dir), ['config.json']);
    assert.equal(resolveProjectPath(loadConfig(['--config', configPath]).endcaps.ending.video), path.join(projectRoot, 'package.json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('ASS の取得に失敗しても一時設定を削除する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endcard-ass-'));
  try {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ output: { resolution: 'invalid' } }));
    assert.throws(() => readEndcardAss(configPath, dir));
    assert.deepEqual(fs.readdirSync(dir), ['config.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
