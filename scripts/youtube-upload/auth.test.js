import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { login } from './auth.js';
import { loadEnv } from './env.js';

// loopback サーバも OAuth も偽物にしてソケットを開かずに認可フローを検証する。
function fixture(t, expectedChannelId = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env.local'), '# 保持\nYOUTUBE_REFRESH_TOKEN=old-fake\n');
  let callback;
  let authOptions;
  let closed = false;
  const logs = [];
  const replies = [];
  const oauth = {
    generateCodeVerifierAsync: async () => ({ codeVerifier: 'fake-verifier', codeChallenge: 'fake-challenge' }),
    generateAuthUrl: (options) => { authOptions = options; return 'https://example.invalid/oauth'; },
    getToken: async (options) => {
      assert.deepEqual(options, { code: 'fake-code', codeVerifier: 'fake-verifier', redirect_uri: 'http://127.0.0.1:12345/oauth2callback' });
      return { tokens: { refresh_token: 'fake-new-refresh', access_token: 'fake-access' } };
    },
    setCredentials: (tokens) => { assert.equal(tokens.access_token, 'fake-access'); },
  };
  const respond = (query, pathname = '/oauth2callback') => callback({ url: `${pathname}?${new URLSearchParams(query)}` }, {
    writeHead(status) {
      replies.push(status);
      return { end() {} };
    },
  });
  const options = {
    root, env: { YOUTUBE_CHANNEL_ID: expectedChannelId }, log: (text) => logs.push(text),
    oauthForEnv: (_env, uri) => {
      if (uri) {
        assert.equal(uri, 'http://127.0.0.1:12345/oauth2callback');
      }
      return oauth;
    },
    clientForOAuth: (client) => {
      assert.equal(client, oauth);
      return { channels: { list: async (args) => {
        assert.equal(args.mine, true);
        return { data: { items: [{ id: 'UCtest', snippet: { title: 'テスト' } }] } };
      } } };
    },
    createServer: (handler) => {
      callback = handler;
      return {
        once() {},
        listen(port, host, ready) {
          assert.equal(port, 0);
          assert.equal(host, '127.0.0.1');
          ready();
        },
        address: () => ({ port: 12345 }),
        close: (done) => { closed = true; done(); },
        closeAllConnections() {},
      };
    },
    open: async () => {
      assert.equal(authOptions.access_type, 'offline');
      assert.equal(authOptions.prompt, 'consent');
      assert.equal(authOptions.code_challenge, 'fake-challenge');
      assert.equal(authOptions.code_challenge_method, 'S256');
      assert.deepEqual(authOptions.scope, ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl']);
      respond({ state: 'wrong', code: 'fake-code' });
      respond({}, '/favicon.ico');
      respond({ state: authOptions.state, code: 'fake-code' });
    },
  };
  return { root, options, logs, replies, oauth, respond, state: () => authOptions.state, closed: () => closed };
}

test('OAuth は loopback 空きポート・PKCE・state・offline・consent。token を表示しない', async (t) => {
  const f = fixture(t);
  await login(f.options);
  assert.deepEqual(f.replies, [400, 404, 200]);
  const env = loadEnv(f.root, {});
  assert.equal(env.YOUTUBE_REFRESH_TOKEN, 'fake-new-refresh');
  assert.equal(env.YOUTUBE_CHANNEL_ID, 'UCtest');
  assert.ok(f.logs.some((line) => line.includes('UCtest')));
  assert.ok(f.logs.every((line) => !line.includes('fake-new-refresh') && !line.includes('fake-access')));
  assert.equal(f.closed(), true);
});

test('認可チャンネルが設定と違えば token を保存しない', async (t) => {
  const f = fixture(t, 'UCother');
  await assert.rejects(login(f.options), /保存しません/u);
  assert.equal(fs.readFileSync(path.join(f.root, '.env.local'), 'utf8'), '# 保持\nYOUTUBE_REFRESH_TOKEN=old-fake\n');
  assert.equal(f.closed(), true);
});

test('認可取消と refresh token 不在は保存せずに閉じる', async (t) => {
  const f = fixture(t);
  f.options.open = async () => f.respond({ state: f.state(), error: 'access_denied' });
  await assert.rejects(login(f.options), /取り消された/u);
  assert.equal(f.closed(), true);
  const missing = fixture(t);
  missing.oauth.getToken = async () => ({ tokens: { access_token: 'fake-access' } });
  await assert.rejects(login(missing.options), /保存しません/u);
  assert.equal(loadEnv(missing.root, {}).YOUTUBE_REFRESH_TOKEN, 'old-fake');
});

test('ブラウザ起動失敗・認可待ちタイムアウトでもサーバを閉じる', async (t) => {
  const f = fixture(t);
  f.options.open = async () => { throw new Error('fake open failure'); };
  await assert.rejects(login(f.options), /open failure/u);
  assert.equal(f.closed(), true);
  const timeout = fixture(t);
  timeout.options.open = async () => {};
  timeout.options.timeoutMs = 1;
  await assert.rejects(login(timeout.options), /タイムアウト/u);
  assert.equal(timeout.closed(), true);
});
