import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildPlan, loadPlan, tagLength } from './plan.js';
import { main, expandVideos, parseOptions } from './index.js';

const sha256 = 'a'.repeat(64);
const valid = { videoPath: 'sample.mp4', sha256, meta: { upload: { title: 'タイトル' }, tags: ['梢桃音'] }, description: '概要欄' };

test('title は 1〜100 文字、概要欄は UTF-8 で 5,000 バイト、両方で <> を拒む', () => {
  assert.deepEqual(buildPlan(valid).errors, []);
  for (const title of ['', 'あ'.repeat(101), '<題', '題>']) {
    assert.ok(buildPlan({ ...valid, options: { title } }).errors.length > 0);
  }
  assert.deepEqual(buildPlan({ ...valid, options: { title: '😀'.repeat(100) }, description: 'あ'.repeat(1666) + 'ab' }).errors, []);
  for (const description of ['あ'.repeat(1667), '<概要', '概要>']) {
    assert.ok(buildPlan({ ...valid, description }).errors.length > 0);
  }
});

test('タグはカンマと空白入りタグの引用符 2 文字も数える', () => {
  assert.equal(tagLength(['ab', 'c d']), 8);
  assert.equal(tagLength([]), 0);
  assert.equal(tagLength(['😀']), 1);
  assert.deepEqual(buildPlan({ ...valid, meta: { upload: valid.meta.upload, tags: ['a'.repeat(496), 'b'] } }).errors, []);
  assert.ok(buildPlan({ ...valid, meta: { upload: valid.meta.upload, tags: ['a'.repeat(496), 'b c'] } }).errors.length > 0);
  assert.ok(buildPlan({ ...valid, meta: { upload: valid.meta.upload, tags: [null] } }).errors.length > 0);
});

test('サムネイルは jpeg/png の 50MB 以下、公開状態は private 固定', () => {
  for (const mimeType of ['image/jpeg', 'image/png']) {
    const plan = buildPlan({ ...valid, thumbnail: { mimeType, bytes: 50 * 1024 * 1024 } });
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.requestBody.status.privacyStatus, 'private');
    assert.equal(plan.requestBody.snippet.categoryId, '24');
    assert.equal(plan.requestBody.status.containsSyntheticMedia, false);
  }
  for (const thumbnail of [{ mimeType: 'image/webp', bytes: 1 }, { mimeType: 'image/png', bytes: 50 * 1024 * 1024 + 1 }]) {
    assert.ok(buildPlan({ ...valid, thumbnail }).errors.length > 0);
  }
});

test('manifest v2 の SHA が一致し、同じ場所の QC だけを信じる', () => {
  const manifest = { version: 2, videoSha256: sha256 };
  const qc = { summary: { error: 1 }, results: [{ level: 'error' }] };
  assert.equal(buildPlan(valid).warnings.length, 2);
  assert.ok(buildPlan({ ...valid, manifest: { version: 1 } }).errors.length > 0);
  assert.ok(buildPlan({ ...valid, manifest: { ...manifest, videoSha256: 'b'.repeat(64) } }).errors.length > 0);
  assert.deepEqual(buildPlan({ ...valid, manifest, qc, qcTrusted: false }).errors, []);
  assert.ok(buildPlan({ ...valid, manifest, qc, qcTrusted: true }).errors.length > 0);
  assert.ok(buildPlan({ ...valid, manifest, qc: {}, qcTrusted: true }).errors.length > 0);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'output');
  const reviewed = path.join(output, '0_reviewed');
  const subdir = path.join(output, 'shorts');
  fs.mkdirSync(reviewed, { recursive: true });
  fs.mkdirSync(subdir);
  const videoPath = path.join(subdir, 'sample.mp4');
  fs.writeFileSync(videoPath, 'fake video');
  const sha = createHash('sha256').update('fake video').digest('hex');
  const write = (dir, suffix, text) => fs.writeFileSync(path.join(dir, `sample.${suffix}`), text);
  write(output, 'meta.json', JSON.stringify(valid.meta));
  write(reviewed, 'youtube.txt', 'reviewed description');
  write(output, 'render.json', JSON.stringify({ version: 2, videoSha256: sha }));
  return { root, output, reviewed, subdir, videoPath, write };
}

test('付随ファイルは隣 → output → reviewed の順。QC は manifest の隣だけ', async (t) => {
  const f = fixture(t);
  f.write(f.reviewed, 'qc.json', JSON.stringify({ summary: { error: 1 }, results: [{ level: 'error' }] }));
  let plan = await loadPlan(f.videoPath, { projectRoot: f.root });
  assert.deepEqual(plan.errors, []);
  assert.match(plan.warnings[0], /QC/u);
  assert.equal(plan.requestBody.snippet.description, 'reviewed description');
  f.write(f.output, 'youtube.txt', 'output description');
  assert.equal((await loadPlan(f.videoPath, { projectRoot: f.root })).requestBody.snippet.description, 'output description');
  f.write(f.subdir, 'youtube.txt', 'neighbor description');
  f.write(f.output, 'qc.json', JSON.stringify({ summary: { error: 1 }, results: [] }));
  plan = await loadPlan(f.videoPath, { projectRoot: f.root });
  assert.equal(plan.requestBody.snippet.description, 'neighbor description');
  assert.match(plan.errors[0], /error/u);
});

test('実体 MIME を検査し、分割コメントは数値順で返信用に読む。no オプションで省く', async (t) => {
  const f = fixture(t);
  f.write(f.subdir, 'thumbnail.jpg', 'not an image');
  for (let n = 1; n <= 12; n++) {
    f.write(f.output, `comment-${n}.txt`, `本文${n}`);
  }
  let plan = await loadPlan(f.videoPath, { projectRoot: f.root });
  assert.match(plan.errors[0], /jpeg/u);
  assert.equal(plan.comments[10], '本文11');
  plan = await loadPlan(f.videoPath, { projectRoot: f.root, noThumbnail: true, noComment: true });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.thumbnail, null);
  assert.deepEqual(plan.comments, []);
  fs.unlinkSync(path.join(f.output, 'sample.comment-3.txt'));
  await assert.rejects(loadPlan(f.videoPath, { projectRoot: f.root, noThumbnail: true }), /連続/u);
});

test('必須ファイル欠落・不正 JSON・非 mp4 は停止する', async (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.output, 'sample.meta.json'));
  await assert.rejects(loadPlan(f.videoPath, { projectRoot: f.root }), /meta.json がありません/u);
  f.write(f.output, 'meta.json', '{');
  await assert.rejects(loadPlan(f.videoPath, { projectRoot: f.root }));
  await assert.rejects(loadPlan('sample.txt', { projectRoot: f.root }), /mp4/u);
});

test('CLI は複数指定と glob を展開し、重複・未知オプション・空一致を扱う', (t) => {
  const f = fixture(t);
  assert.deepEqual(expandVideos(['output/shorts/*.mp4', f.videoPath], f.root), [f.videoPath]);
  assert.throws(() => expandVideos(['missing-*.mp4'], f.root), /見つかりません/u);
  assert.deepEqual(parseOptions(['--video', 'a.mp4', '--video', '*.mp4']).videos, ['a.mp4', '*.mp4']);
  assert.throws(() => parseOptions(['--privacyStatus', 'public']));
  assert.throws(() => parseOptions(['--login', '--video', 'a.mp4']));
  assert.throws(() => parseOptions([]));
});

test('jpg と png が別の場所にある場合も動画の隣を優先する', async (t) => {
  const f = fixture(t);
  f.write(f.output, 'thumbnail.jpg', Buffer.from([0xff, 0xd8, 0xff]));
  f.write(f.subdir, 'thumbnail.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const plan = await loadPlan(f.videoPath, { projectRoot: f.root });
  assert.equal(plan.thumbnail.path, path.join(f.subdir, 'sample.thumbnail.png'));
  assert.equal(plan.thumbnail.mimeType, 'image/png');
});

test('CLI dry-run は env も API も使わず、送信内容と Studio の確認項目を表示する', async (t) => {
  const f = fixture(t);
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'warn', () => {});
  const forbidden = () => { throw new Error('env/API を呼んではいけません'); };
  await main(['--video', f.videoPath, '--dry-run'], f.root, { loadEnvironment: forbidden, clientForEnv: forbidden });
  assert.ok(logs.some((line) => line.includes('reviewed description')));
  assert.ok(logs.some((line) => line.includes('private')));
  assert.ok(logs.some((line) => line.includes('Studio で手作業')));
  assert.equal(fs.existsSync(f.videoPath.replace('.mp4', '.upload.json')), false);
});

test('後続候補に error があれば最初の動画も送信しない', async (t) => {
  const f = fixture(t);
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  const forbidden = () => { calls++; throw new Error('通信禁止'); };
  const invalid = path.join(f.subdir, 'invalid.mp4');
  fs.writeFileSync(invalid, 'fake video');
  await assert.rejects(main(['--video', f.videoPath, '--video', invalid], f.root,
    { loadEnvironment: forbidden, clientForEnv: forbidden }), /何も送信しません/u);
  assert.equal(calls, 0);
});

test('CLI は順番に処理し、動画送信の失敗後に次の動画を送らない', async (t) => {
  const f = fixture(t);
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const second = path.join(f.subdir, 'second.mp4');
  fs.writeFileSync(second, 'fake second');
  fs.writeFileSync(second.replace('.mp4', '.meta.json'), JSON.stringify(valid.meta));
  fs.writeFileSync(second.replace('.mp4', '.youtube.txt'), 'second description');
  const calls = [];
  const client = {
    channels: { list: async () => {
      calls.push('channel');
      return { data: { items: [{ id: 'UCtest' }] } };
    } },
    videos: { insert: async ({ media }) => {
      calls.push(media.body.path);
      for await (const chunk of media.body) {
        assert.ok(chunk.length > 0);
      }
      throw new Error('fake failure');
    } },
  };
  await assert.rejects(main(['--video', f.videoPath, '--video', second], f.root,
    { loadEnvironment: () => ({ YOUTUBE_CHANNEL_ID: 'UCtest' }), clientForEnv: () => client }), /動画送信/u);
  assert.deepEqual(calls, ['channel', f.videoPath]);
  assert.equal(fs.existsSync(second.replace('.mp4', '.upload.json')), false);
});
