import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { main, parseOptions } from './index.js';
import { createSourcePlaylist, loadPlaylistPlan, playlistEstimate, playlistRecordPath,
  readPlaylistRecord, writePlaylistRecord } from './playlist.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-playlist-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'video.mp4');
  const metaPath = path.join(root, 'video.meta.json');
  fs.writeFileSync(videoPath, '動画の代わり');
  const meta = { upload: { title: 'まとめ動画' }, sources: ['first', 'second', 'first', 'third'].map((videoId) => ({ videoId })) };
  const writeMeta = () => fs.writeFileSync(metaPath, JSON.stringify(meta));
  writeMeta();
  const calls = [];
  const remote = [];
  let failVideo;
  let failMethod;
  const quota = { message: '秘密の例外', config: { headers: { Authorization: '秘密のトークン' } },
    response: { status: 403, data: { error: { message: 'Quota exceeded.', errors: [{ reason: 'quotaExceeded' }] } } } };
  const method = (name, handler) => async (args, options) => {
    calls.push({ name, args, options });
    assert.equal(options.retry, false);
    if (name === failMethod) {
      throw quota;
    }
    return { data: handler(args) };
  };
  const client = {
    channels: { list: method('channels.list', () => ({ items: [{ id: 'UCtest' }] })) },
    playlists: { insert: method('playlists.insert', () => {
      assert.equal(readPlaylistRecord(videoPath).playlistId, null);
      return { id: 'playlist-id' };
    }) },
    playlistItems: {
      list: method('playlistItems.list', (args) => {
        const offset = Number(args.pageToken ?? 0);
        const items = remote.slice(offset, offset + 2).map((videoId) => ({ id: `item-${videoId}`, snippet: { resourceId: { videoId } } }));
        return { items, ...(offset + 2 < remote.length ? { nextPageToken: String(offset + 2) } : {}) };
      }),
      insert: method('playlistItems.insert', (args) => {
        const { videoId } = args.requestBody.snippet.resourceId;
        const record = readPlaylistRecord(videoPath);
        assert.equal(record.playlistId, 'playlist-id');
        assert.equal(record.items.length, remote.length);
        if (videoId === failVideo) {
          throw quota;
        }
        remote.push(videoId);
        return { id: `item-${videoId}` };
      }),
    },
  };
  const load = (options = {}) => loadPlaylistPlan(videoPath, { projectRoot: root, ...options });
  const run = () => createSourcePlaylist(load(), { client, channelId: 'UCtest' });
  const dependencies = { loadEnvironment: () => ({ YOUTUBE_CHANNEL_ID: 'UCtest' }), clientForEnv: () => client };
  return { root, videoPath, metaPath, meta, writeMeta, client, calls, remote, load, run, dependencies,
    fail: (videoId) => { failVideo = videoId; }, failMethod: (name) => { failMethod = name; } };
}

function insertions(f) {
  return f.calls.filter((call) => call.name === 'playlistItems.insert').map((call) => call.args.requestBody.snippet.resourceId.videoId);
}

test('新規作成は初登場順・重複除去・限定公開で全件を追加し API ごとに記録する', async (t) => {
  const f = fixture(t);
  const result = await f.run();
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list', 'playlists.insert',
    'playlistItems.insert', 'playlistItems.insert', 'playlistItems.insert']);
  assert.deepEqual(insertions(f), ['first', 'second', 'third']);
  assert.deepEqual(f.calls[1].args, { part: ['snippet', 'status'], requestBody: {
    snippet: { title: '【出典】まとめ動画', description: '「まとめ動画」で使った配信（初登場順）' }, status: { privacyStatus: 'unlisted' },
  } });
  assert.deepEqual(result, readPlaylistRecord(f.videoPath));
  assert.equal(result.version, 1);
  assert.equal(result.channelId, 'UCtest');
  assert.equal(result.video, 'video.mp4');
  assert.equal(result.url, 'https://www.youtube.com/playlist?list=playlist-id');
  assert.ok(Number.isFinite(Date.parse(result.createdAt)));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.items, ['first', 'second', 'third'].map((videoId) => ({ videoId, playlistItemId: `item-${videoId}` })));
  assert.equal(fs.existsSync(f.videoPath.replace('.mp4', '.upload.json')), false);
});

test('quotaExceeded は直前までの記録を残し、再開では同じリストに未追加分だけを送る', async (t) => {
  const f = fixture(t);
  f.fail('second');
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /HTTP 403.*quotaExceeded.*Quota exceeded.*playlist.json.*同じコマンド/u);
    assert.ok(!error.message.includes('秘密'));
    return true;
  });
  const record = readPlaylistRecord(f.videoPath);
  assert.equal(record.playlistId, 'playlist-id');
  assert.equal(record.items.length, 1);
  assert.deepEqual(record.failures[0], { stage: '出典の追加', status: 403, reasons: ['quotaExceeded'],
    message: 'Quota exceeded.', code: null, at: record.failures[0].at });
  assert.ok(Number.isFinite(Date.parse(record.failures[0].at)));
  assert.ok(!JSON.stringify(record).includes('秘密'));
  f.calls.length = 0;
  f.fail(null);
  const result = await f.run();
  assert.deepEqual(insertions(f), ['second', 'third']);
  assert.equal(f.calls.some((call) => call.name === 'playlists.insert'), false);
  assert.equal(result.failures.length, 1);
});

test('記録前に入った項目をページングで回収し、完了済みなら追加しない', async (t) => {
  const f = fixture(t);
  await f.run();
  const record = readPlaylistRecord(f.videoPath);
  record.items = [];
  writePlaylistRecord(f.videoPath, record);
  f.calls.length = 0;
  const result = await f.run();
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list', 'playlistItems.list', 'playlistItems.list']);
  assert.deepEqual(f.calls[1].args, { part: ['snippet'], playlistId: 'playlist-id', maxResults: 50 });
  assert.equal(f.calls[2].args.pageToken, '2');
  assert.equal(result.items.length, 3);
  assert.equal(readPlaylistRecord(f.videoPath).items.length, 3);
});

test('記録にある videoId も既存項目との和集合で送信を避ける', async (t) => {
  const f = fixture(t);
  await f.run();
  f.remote.length = 0;
  f.calls.length = 0;
  await f.run();
  assert.deepEqual(insertions(f), []);
});

test('チャンネル不一致・未設定では追加も作成も送らない', async (t) => {
  const f = fixture(t);
  await assert.rejects(createSourcePlaylist(f.load(), { client: f.client }), /YOUTUBE_CHANNEL_ID/u);
  assert.deepEqual(f.calls, []);
  await assert.rejects(createSourcePlaylist(f.load(), { client: f.client, channelId: 'UCwrong' }), /違います/u);
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list']);
  assert.equal(readPlaylistRecord(f.videoPath), null);
  await f.run();
  f.calls.length = 0;
  await assert.rejects(createSourcePlaylist(f.load(), { client: f.client, channelId: 'UCother' }), /playlist.json.*チャンネル/u);
  assert.deepEqual(f.calls, []);
});

test('sources が無い・空・不正なら通信前にエラー', async (t) => {
  const f = fixture(t);
  for (const sources of [undefined, [], [{ title: 'ID なし' }]]) {
    f.meta.sources = sources;
    f.writeMeta();
    await assert.rejects(main(['--video', f.videoPath, '--source-playlist'], f.root, f.dependencies), /sources/u);
  }
  assert.deepEqual(f.calls, []);
});

test('CLI dry-run は env・API・記録書き込みなしで見積もりを出す（新規と再開）', async (t) => {
  const f = fixture(t);
  const logs = [];
  t.mock.method(console, 'log', (value) => logs.push(value));
  const forbidden = () => { throw new Error('呼び出し禁止'); };
  const dryRun = () => main(['--video', f.videoPath, '--source-playlist', '--dry-run'], f.root,
    { loadEnvironment: forbidden, clientForEnv: forbidden });
  await dryRun();
  assert.match(logs.join('\n'), /【出典】まとめ動画.*\n公開範囲: unlisted/u);
  assert.match(logs.join('\n'), /追加予定: 3 本 \/ 記録済み: 0 本/u);
  assert.match(logs.join('\n'), /200 units/u);
  assert.deepEqual(f.calls, []);
  assert.equal(readPlaylistRecord(f.videoPath), null);
  f.fail('second');
  await assert.rejects(f.run());
  const before = fs.readFileSync(playlistRecordPath(f.videoPath), 'utf8');
  f.calls.length = 0;
  logs.length = 0;
  await dryRun();
  assert.match(logs.join('\n'), /追加予定: 2 本 \/ 記録済み: 1 本/u);
  assert.match(logs.join('\n'), /101 units/u);
  assert.equal(fs.readFileSync(playlistRecordPath(f.videoPath), 'utf8'), before);
  assert.deepEqual(f.calls, []);
});

test('CLI は glob・複数指定を順に処理し、失敗後の動画を処理しない', async (t) => {
  const f = fixture(t);
  const second = path.join(f.root, 'z.mp4');
  fs.writeFileSync(second, '動画');
  fs.copyFileSync(f.metaPath, path.join(f.root, 'z.meta.json'));
  const uploadFile = f.videoPath.replace('.mp4', '.upload.json');
  fs.writeFileSync(uploadFile, '既存の動画記録は読まず変更しない');
  f.fail('second');
  await assert.rejects(main(['--video', '*.mp4', '--video', f.videoPath, '--source-playlist'], f.root, f.dependencies), /quotaExceeded/u);
  assert.equal(fs.existsSync(playlistRecordPath(second)), false);
  assert.equal(fs.readFileSync(uploadFile, 'utf8'), '既存の動画記録は読まず変更しない');
  assert.equal(f.calls.filter((call) => call.name === 'playlists.insert').length, 1);
});

test('CLI の完了時に URL を表示し、動画・サムネイル・コメントの API は使わない', async (t) => {
  const f = fixture(t);
  const logs = [];
  t.mock.method(console, 'log', (value) => logs.push(value));
  await main(['--video', f.videoPath, '--source-playlist', '--playlist-title', '出典一覧', '--playlist-privacy', 'private'], f.root, f.dependencies);
  assert.match(logs.join('\n'), /出典の再生リスト: https:\/\/www.youtube.com\/playlist\?list=playlist-id/u);
  const record = readPlaylistRecord(f.videoPath);
  assert.equal(record.title, '出典一覧');
  assert.equal(record.privacyStatus, 'private');
  assert.ok(f.calls.every((call) => /^(channels|playlists|playlistItems)\./u.test(call.name)));
});

test('タイトル必須・公開範囲・再開時の設定保持・CLI オプションの検証', (t) => {
  const f = fixture(t);
  delete f.meta.upload.title;
  f.writeMeta();
  assert.throws(() => f.load(), /--playlist-title/u);
  assert.equal(f.load({ playlistTitle: '指定タイトル' }).title, '指定タイトル');
  assert.throws(() => f.load({ playlistTitle: '' }), /タイトル/u);
  assert.throws(() => parseOptions(['--video', 'a.mp4', '--source-playlist', '--playlist-privacy', 'invalid']), /playlist-privacy/u);
  assert.throws(() => parseOptions(['--video', 'a.mp4', '--playlist-title', '題']), /source-playlist/u);
  const options = parseOptions(['--video', 'a.mp4', '--source-playlist']);
  assert.equal(options.sourcePlaylist, true);
  assert.equal(options.playlistPrivacy, 'unlisted');
  for (const privacy of ['unlisted', 'public', 'private']) {
    assert.equal(f.load({ playlistTitle: '題', playlistPrivacy: privacy }).privacyStatus, privacy);
  }
});

test('付随 meta.json は隣 → output → output/0_reviewed の順で探す', (t) => {
  const f = fixture(t);
  const output = path.join(f.root, 'output');
  const reviewed = path.join(output, '0_reviewed');
  fs.mkdirSync(reviewed, { recursive: true });
  const write = (dir, title) => fs.writeFileSync(path.join(dir, 'video.meta.json'), JSON.stringify({ ...f.meta, upload: { title } }));
  write(output, 'output');
  write(reviewed, 'reviewed');
  assert.equal(f.load().title, '【出典】まとめ動画');
  fs.rmSync(f.metaPath);
  assert.equal(f.load().title, '【出典】output');
  fs.rmSync(path.join(output, 'video.meta.json'));
  assert.equal(f.load().title, '【出典】reviewed');
});

test('確認 API 失敗も記録し、履歴は直近 10 件。再開時は既存タイトル・公開範囲を維持する', async (t) => {
  const f = fixture(t);
  await f.run();
  f.failMethod('playlistItems.list');
  for (let i = 0; i < 12; i++) {
    await assert.rejects(f.run(), /再生リスト確認.*quotaExceeded/u);
  }
  assert.equal(readPlaylistRecord(f.videoPath).failures.length, 10);
  const plan = f.load({ playlistTitle: '別の題', playlistPrivacy: 'public' });
  assert.equal(plan.title, '【出典】まとめ動画');
  assert.equal(plan.privacyStatus, 'unlisted');
  assert.deepEqual(playlistEstimate(plan), { recorded: 3, pending: 0, creation: 0, list: 1, units: 1 });
});
