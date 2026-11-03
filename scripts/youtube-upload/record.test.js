import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRecord, readRecord, recordErrors, recordPathFor, writeRecord } from './record.js';

const sha256 = 'a'.repeat(64);
const plan = { videoPath: 'sample.mp4', sha256, requestBody: { snippet: { title: 'タイトル' } } };

test('失敗した動画の再送には retry-video が必要で、ハッシュ違いは常に止める', () => {
  const record = createRecord(plan, 'UCtest');
  assert.deepEqual(recordErrors(null, sha256), []);
  record.steps.video = 'failed';
  assert.match(recordErrors(record, sha256)[0], /--retry-video/u);
  assert.deepEqual(recordErrors(record, sha256, { retryVideo: true }), []);
  assert.match(recordErrors(record, 'b'.repeat(64), { retryVideo: true })[0], /SHA-256/u);
});

test('QC の error を無視して上げたことを記録に残す', () => {
  assert.equal(createRecord(plan, 'UCtest').qcErrorAllowed, false);
  assert.equal(createRecord({ ...plan, qcErrorAllowed: true }, 'UCtest').qcErrorAllowed, true);
});

test('動画のみ成功なら再開し、すべて done または skipped なら二重送信を止める', () => {
  const record = createRecord(plan, 'UCtest');
  record.steps.video = 'done';
  record.videoId = 'video-id';
  assert.deepEqual(recordErrors(record, sha256), []);
  record.steps.thumbnail = 'skipped';
  record.steps.comment = 'done';
  assert.match(recordErrors(record, sha256)[0], /アップロード済み/u);
});

test('段ごとの記録を原子的に読み書きし、不正な記録は無視しない', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-record-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'sample.mp4');
  assert.equal(readRecord(videoPath), null);
  const record = createRecord(plan, 'UCtest');
  writeRecord(videoPath, record);
  assert.deepEqual(readRecord(videoPath), record);
  record.steps.video = 'done';
  record.videoId = 'video-id';
  record.commentIds.push('comment-id');
  writeRecord(videoPath, record);
  assert.deepEqual(readRecord(videoPath), record);
  assert.equal(fs.existsSync(`${recordPathFor(videoPath)}.tmp`), false);
  for (const text of ['{', '{}', JSON.stringify({ ...record, version: 9 }), JSON.stringify({ ...record, videoId: null })]) {
    fs.writeFileSync(recordPathFor(videoPath), text);
    assert.throws(() => readRecord(videoPath), /upload.json を読めません/u);
  }
});
