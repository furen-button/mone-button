import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { youtube, auth } from '@googleapis/youtube';
import { saveLogin } from './env.js';
import { getChannel, apiFailure } from './api.js';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];

export function createOAuthClient(env, redirectUri) {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YOUTUBE_CLIENT_ID と YOUTUBE_CLIENT_SECRET を設定してください。');
  }
  return new auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, redirectUri);
}

export function createApiClient(env) {
  if (!env.YOUTUBE_REFRESH_TOKEN) {
    throw new Error('YOUTUBE_REFRESH_TOKEN が必要です。先に --login を実行してください。');
  }
  const oauth = createOAuthClient(env);
  oauth.setCredentials({ refresh_token: env.YOUTUBE_REFRESH_TOKEN });
  return youtube({ version: 'v3', auth: oauth });
}

export function openBrowser(url) {
  return new Promise((resolve, reject) => {
    execFile('open', [url], (error) => {
      if (error) {
        reject(new Error('ブラウザを開けませんでした。macOS の open を確認してください。'));
      } else {
        resolve();
      }
    });
  });
}

// loopback だけで待ち受け、state と PKCE の両方で認可応答を結び付ける。
export async function login({ root, env, open = openBrowser, log = console.log, timeoutMs = 180_000,
  createServer = http.createServer, oauthForEnv = createOAuthClient,
  clientForOAuth = (oauth) => youtube({ version: 'v3', auth: oauth }) }) {
  oauthForEnv(env);
  const state = randomBytes(32).toString('hex');
  let accept;
  let refuse;
  const callback = new Promise((resolve, reject) => { accept = resolve; refuse = reject; });
  // ブラウザを開いている間のタイムアウトも未処理 rejection にしない。
  callback.catch(() => {});
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404).end();
      return;
    }
    const actual = Buffer.from(url.searchParams.get('state') || '');
    const expected = Buffer.from(state);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.writeHead(400).end('Invalid state');
      return;
    }
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      res.writeHead(400).end('Authorization failed');
      refuse(new Error('OAuth 認可が取り消されたか、認可コードがありません。'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('認可を受け付けました。この画面を閉じて端末を確認してください。');
    accept(url.searchParams.get('code'));
  });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    timer = setTimeout(() => refuse(new Error('OAuth 認可がタイムアウトしました。')), timeoutMs);
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
    const oauth = oauthForEnv(env, redirectUri);
    const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
    const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES,
      state, code_challenge: codeChallenge, code_challenge_method: 'S256' });
    await open(url);
    const code = await callback;
    let tokens;
    let channel;
    try {
      ({ tokens } = await oauth.getToken({ code, codeVerifier, redirect_uri: redirectUri }));
      oauth.setCredentials(tokens);
      channel = await getChannel(clientForOAuth(oauth));
    } catch (error) {
      throw apiFailure('OAuth 認証', error);
    }
    log(`チャンネル: ${channel.title} (${channel.id})`);
    saveLogin(root, { refreshToken: tokens.refresh_token, channelId: channel.id, expectedChannelId: env.YOUTUBE_CHANNEL_ID });
    log('認証情報を .env.local に保存しました。');
  } finally {
    clearTimeout(timer);
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
