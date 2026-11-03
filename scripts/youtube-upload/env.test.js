import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadEnv, saveLogin } from './env.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('env はプロセス > local > env、空文字も優先する', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'A=base\nB=base\nC=base\nQUOTED="日本語 # 値"\n');
  fs.writeFileSync(path.join(root, '.env.local'), 'A=local\nB=local\n');
  assert.deepEqual(loadEnv(root, { A: '', D: 'process' }), { A: '', B: 'local', C: 'base', QUOTED: '日本語 # 値', D: 'process' });
  assert.deepEqual(loadEnv(fixture(t), {}), {});
});

test('token 行だけを変更し、CRLF・コメント・他の値を維持する', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env.local');
  fs.writeFileSync(file, '# メモ\r\n  export YOUTUBE_REFRESH_TOKEN = old # 古い\r\nX = " a "\r\nYOUTUBE_CHANNEL_ID=UCtest');
  saveLogin(root, { refreshToken: 'fake-new-token', channelId: 'UCtest', expectedChannelId: 'UCtest' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# メモ\r\nYOUTUBE_REFRESH_TOKEN="fake-new-token"\r\nX = " a "\r\nYOUTUBE_CHANNEL_ID=UCtest');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('無い token と空の channel は追記または更新する', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env.local');
  fs.writeFileSync(file, '# 保持\nYOUTUBE_CHANNEL_ID=\nX=1');
  saveLogin(root, { refreshToken: 'fake-token', channelId: 'UCtest', expectedChannelId: '' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# 保持\nYOUTUBE_CHANNEL_ID="UCtest"\nX=1\nYOUTUBE_REFRESH_TOKEN="fake-token"\n');
  const empty = fixture(t);
  saveLogin(empty, { refreshToken: 'fake-token', channelId: 'UCtest' });
  assert.equal(loadEnv(empty, {}).YOUTUBE_CHANNEL_ID, 'UCtest');
});

test('チャンネル不一致や refresh token 不在なら既存ファイルに触れない', (t) => {
  const root = fixture(t);
  const file = path.join(root, '.env.local');
  fs.writeFileSync(file, '# 保持\n');
  for (const values of [
    { refreshToken: 'fake-token', channelId: 'UCother', expectedChannelId: 'UCtest' },
    { channelId: 'UCtest' },
    { refreshToken: 'fake\ntoken', channelId: 'UCtest' },
  ]) {
    assert.throws(() => saveLogin(root, values));
    assert.equal(fs.readFileSync(file, 'utf8'), '# 保持\n');
  }
});
