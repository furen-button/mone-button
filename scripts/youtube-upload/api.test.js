import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildPlan } from './plan.js';
import { uploadPlan, apiFailure } from './api.js';
import { createRecord, readRecord, writeRecord } from './record.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-api-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'video.mp4');
  const image = path.join(root, 'image.png');
  fs.writeFileSync(videoPath, 'fake video');
  fs.writeFileSync(image, 'fake image');
  const plan = buildPlan({ videoPath, sha256: 'a'.repeat(64), meta: { upload: { title: '題', categoryId: '22', containsSyntheticMedia: true }, tags: ['タグ'] },
    description: '概要', thumbnail: { path: image, mimeType: 'image/png', bytes: 10 }, comments: ['本文1', '本文2', '本文3'] });
  const calls = [];
  let fail;
  const method = (name, response) => async (args, options) => {
    calls.push({ name, args, options });
    if (name === 'videos.insert') {
      assert.equal(readRecord(videoPath).steps.video, 'failed');
    }
    if (args.media) {
      for await (const chunk of args.media.body) {
        assert.ok(chunk.length > 0);
      }
    }
    if (fail === name) {
      throw { response: { status: 503 }, message: 'fake-secret-in-request' };
    }
    return { data: response };
  };
  const client = {
    channels: { list: method('channels.list', { items: [{ id: 'UCtest', snippet: { title: 'テスト' } }] }) },
    videos: { insert: method('videos.insert', { id: 'video-id' }) },
    thumbnails: { set: method('thumbnails.set', {}) },
    commentThreads: { insert: method('commentThreads.insert', { snippet: { topLevelComment: { id: 'top-comment-id' } } }) },
    comments: { insert: method('comments.insert', { id: 'reply-id' }) },
  };
  return { plan, client, calls, setFailure: (name) => { fail = name; } };
}

const options = { channelId: 'UCtest' };

test('API 順序・本文・返信先・再送無効と段ごとの記録', async (t) => {
  const f = fixture(t);
  const record = await uploadPlan(f.plan, { client: f.client, ...options });
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list', 'videos.insert', 'thumbnails.set', 'commentThreads.insert', 'comments.insert', 'comments.insert']);
  assert.ok(f.calls.every((call) => call.options.retry === false));
  assert.deepEqual(f.calls[0].args, { part: ['snippet'], mine: true });
  assert.deepEqual(f.calls[1].args.part, ['snippet', 'status']);
  assert.deepEqual(f.calls[1].args.requestBody, {
    snippet: { title: '題', description: '概要', tags: ['タグ'], categoryId: '22', defaultLanguage: 'ja', defaultAudioLanguage: 'ja' },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  });
  assert.equal(f.calls[2].args.videoId, 'video-id');
  assert.equal(f.calls[3].args.requestBody.snippet.topLevelComment.snippet.textOriginal, '本文1');
  assert.equal(f.calls[4].args.requestBody.snippet.parentId, 'top-comment-id');
  assert.equal(f.calls[5].args.requestBody.snippet.parentId, 'top-comment-id');
  assert.deepEqual(record.steps, { video: 'done', thumbnail: 'done', comment: 'done' });
  assert.deepEqual(record.commentIds, ['top-comment-id', 'reply-id', 'reply-id']);
  assert.equal(record.url, 'https://youtu.be/video-id');
  assert.ok(record.uploadedAt);
  assert.deepEqual(readRecord(f.plan.videoPath), record);
});

test('検査 error・チャンネル未設定・記録との不一致は通信しない', async (t) => {
  const f = fixture(t);
  await assert.rejects(uploadPlan({ ...f.plan, errors: ['invalid'] }, { client: f.client, ...options }), /invalid/u);
  await assert.rejects(uploadPlan(f.plan, { client: f.client }), /YOUTUBE_CHANNEL_ID/u);
  const record = createRecord(f.plan, 'UCother');
  await assert.rejects(uploadPlan({ ...f.plan, record }, { client: f.client, ...options }), /チャンネル/u);
  assert.deepEqual(f.calls, []);
});

test('認可チャンネルが違えば channels.list だけで止める', async (t) => {
  const f = fixture(t);
  await assert.rejects(uploadPlan(f.plan, { client: f.client, channelId: 'UCwrong' }), /違います/u);
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list']);
  assert.equal(readRecord(f.plan.videoPath), null);
});

test('動画送信失敗は failed を残す。再実行は retry-video なしでは通信しない', async (t) => {
  const f = fixture(t);
  f.setFailure('videos.insert');
  await assert.rejects(uploadPlan(f.plan, { client: f.client, ...options }), /動画送信.*HTTP 503/u);
  assert.equal(f.calls.filter((call) => call.name === 'videos.insert').length, 1);
  const record = readRecord(f.plan.videoPath);
  assert.equal(record.steps.video, 'failed');
  const count = f.calls.length;
  await assert.rejects(uploadPlan({ ...f.plan, record }, { client: f.client, ...options }), /--retry-video/u);
  assert.equal(f.calls.length, count);
  f.setFailure(null);
  const result = await uploadPlan({ ...f.plan, record }, { client: f.client, ...options, retryVideo: true });
  assert.equal(result.steps.video, 'done');
});

test('サムネイル失敗は動画 ID を残し、再実行では videos.insert を呼ばない', async (t) => {
  const f = fixture(t);
  f.setFailure('thumbnails.set');
  await assert.rejects(uploadPlan(f.plan, { client: f.client, ...options }), /サムネイル/u);
  const record = readRecord(f.plan.videoPath);
  assert.equal(record.videoId, 'video-id');
  assert.equal(record.steps.thumbnail, 'pending');
  f.calls.length = 0;
  f.setFailure(null);
  await uploadPlan({ ...f.plan, record }, { client: f.client, ...options });
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list', 'thumbnails.set', 'commentThreads.insert', 'comments.insert', 'comments.insert']);
});

test('分割返信の途中失敗では最初のコメントを繰り返さず再開する', async (t) => {
  const f = fixture(t);
  f.setFailure('comments.insert');
  await assert.rejects(uploadPlan(f.plan, { client: f.client, ...options }), /コメント/u);
  const record = readRecord(f.plan.videoPath);
  assert.deepEqual(record.commentIds, ['top-comment-id']);
  assert.equal(record.steps.comment, 'pending');
  f.setFailure(null);
  f.calls.length = 0;
  await uploadPlan({ ...f.plan, record }, { client: f.client, ...options });
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list', 'comments.insert', 'comments.insert']);
});

test('欠落段や no オプションは skipped。完了済みとハッシュ違いは再送しない', async (t) => {
  const f = fixture(t);
  const record = await uploadPlan(f.plan, { client: f.client, ...options, noThumbnail: true, noComment: true });
  assert.deepEqual(record.steps, { video: 'done', thumbnail: 'skipped', comment: 'skipped' });
  assert.deepEqual(f.calls.map((call) => call.name), ['channels.list', 'videos.insert']);
  f.calls.length = 0;
  await assert.rejects(uploadPlan({ ...f.plan, record }, { client: f.client, ...options }), /アップロード済み/u);
  record.steps.comment = 'pending';
  await assert.rejects(uploadPlan({ ...f.plan, record, sha256: 'b'.repeat(64) }, { client: f.client, ...options, retryVideo: true }), /SHA-256/u);
  assert.deepEqual(f.calls, []);
  writeRecord(f.plan.videoPath, record);
});

test('API エラーにリクエストや token の詳細を含めない', () => {
  const error = apiFailure('送信', { message: 'fake-secret', response: { status: 401, data: 'fake-secret' } });
  assert.match(error.message, /HTTP 401/u);
  assert.ok(!error.message.includes('fake-secret'));
});
