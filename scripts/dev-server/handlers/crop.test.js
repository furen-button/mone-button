import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { newUploadId, resolveCropRef } from '../lib/crop-source.js';
import { createCropRoutes, parseCropPayload, pruneUploads, safeStem } from './crop.js';
import { resolveOutputFile } from './files.js';
import { matchRoute } from './index.js';

const KEYFRAMES = [{ t: 0, x: 0.7, y: 0.5, zoom: 1.2 }, { t: 2, x: 0.6, y: 0.5, zoom: 1.6, ease: 'cut' }];
const PROBE = { width: 1920, height: 1080, fps: 30, duration: 5 };

let root;
let context;

function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-crop-'));
  context = { projectRoot: root, outputDir: path.join(root, 'output'), cacheDir: path.join(root, 'cache/createVideo/editor') };
  fs.mkdirSync(path.join(root, 'public/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public/videos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'cache/createVideo/abcdef123'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/data/clip-a.json'), JSON.stringify({
    videoId: 'abcdef123', serif: 'いち', effects: { camera: { '9:16': KEYFRAMES } },
  }));
  fs.writeFileSync(path.join(root, 'public/videos/clip-a.mp4'), 'low');
  fs.writeFileSync(path.join(root, 'cache/createVideo/abcdef123/clip-a.mp4'), 'high-quality');
}

function call(routes, method, url, { body, stream, headers = {} } = {}) {
  const parsed = new URL(url, 'http://localhost');
  const matched = matchRoute(routes, method, parsed.pathname);
  assert.ok(matched, `${method} ${parsed.pathname} にルートが無い`);
  return matched.route.handler({
    method,
    path: parsed.pathname,
    query: parsed.searchParams,
    body,
    stream,
    headers,
    signal: new AbortController().signal,
  }, matched.params);
}

function fakeManager({ busy = false } = {}) {
  return {
    calls: [],
    start(args) {
      if (busy) {
        throw Object.assign(new Error('busy'), { status: 409, jobId: 'job-x' });
      }
      this.calls.push(args);
      return { id: 'job-1', kind: args.kind };
    },
  };
}

describe('crop API', () => {
  beforeEach(setup);
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('クリップを照合し、サーバ上の元動画とサイズ・保存済みのキーフレームを返す', async () => {
    const routes = createCropRoutes(context, fakeManager(), { probe: () => PROBE });
    const result = await call(routes, 'GET', '/crop/clip/clip-a');
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.clip.sources.map((s) => [s.source, s.size]), [['cache:clip-a', 12], ['public:clip-a', 3]]);
    assert.deepEqual(result.json.clip.camera['9:16'], KEYFRAMES);
    assert.equal(result.json.clip.serif, 'いち');
    assert.equal((await call(routes, 'GET', '/crop/clip/missing')).status, 404);
  });

  it('アップロードを保存して照合し、名前が不正・動画でないものは拒否して残骸を消す', async () => {
    const routes = createCropRoutes(context, fakeManager(), { probe: () => PROBE });
    const ok = await call(routes, 'POST', '/crop/upload?name=clip-a.mp4', { stream: Readable.from([Buffer.from('video-bytes')]) });
    assert.equal(ok.status, 200);
    assert.match(ok.json.source, /^upload:/u);
    assert.equal(ok.json.size, 11);
    assert.equal(ok.json.clip.base, 'clip-a');
    const uploaded = resolveOutputFile(context, 'crop-source', ok.json.source);
    assert.equal(fs.readFileSync(uploaded.path, 'utf8'), 'video-bytes');
    assert.equal(resolveCropRef(root, ok.json.source).label, 'clip-a');

    // 括弧や空白を含む普通のファイル名は受け、照合できないだけ。
    const other = await call(routes, 'POST', `/crop/upload?name=${encodeURIComponent('録画 (1).MOV')}`, { stream: Readable.from([Buffer.from('x')]) });
    assert.equal(other.status, 200);
    assert.equal(other.json.clip, null);

    for (const name of ['notes.txt', '../x.mp4', 'a/b.mp4']) {
      const bad = await call(routes, 'POST', `/crop/upload?name=${encodeURIComponent(name)}`, { stream: Readable.from([Buffer.from('x')]) });
      assert.equal(bad.status, 400, name);
    }
    const broken = createCropRoutes(context, fakeManager(), { probe: () => { throw new Error('not a video'); } });
    const before = fs.readdirSync(path.join(root, 'cache/crop/uploads')).length;
    assert.equal((await call(broken, 'POST', '/crop/upload?name=x.mp4', { stream: Readable.from([Buffer.from('x')]) })).status, 422);
    assert.equal(fs.readdirSync(path.join(root, 'cache/crop/uploads')).length, before);
  });

  it('書き出しはキーフレームをファイルに書いて crop ジョブを始める', async () => {
    const manager = fakeManager();
    const routes = createCropRoutes(context, manager, { probe: () => PROBE });
    const body = { source: 'cache:clip-a', keyframes: KEYFRAMES, aspect: '9:16', size: '1080x1920', scaler: 'anime4k' };
    const result = await call(routes, 'POST', '/crop/export', { body });
    assert.equal(result.status, 200);
    const [{ kind, argv }] = manager.calls;
    assert.equal(kind, 'crop');
    const arg = (flag) => argv[argv.indexOf(flag) + 1];
    assert.equal(arg('--input'), path.join(root, 'cache/createVideo/abcdef123/clip-a.mp4'));
    assert.equal(arg('--aspect'), '9:16');
    assert.equal(arg('--scaler'), 'anime4k');
    assert.deepEqual(JSON.parse(fs.readFileSync(arg('--camera'), 'utf8')).map((k) => k.t), [0, 2]);
    assert.match(path.basename(arg('--out')), /^clip-a-9x16-\d{8}-\d{6}\.mp4$/u);

    assert.equal((await call(routes, 'POST', '/crop/export', { body: { ...body, source: 'cache:missing' } })).status, 404);
    const busy = createCropRoutes(context, fakeManager({ busy: true }), { probe: () => PROBE });
    assert.deepEqual((await call(busy, 'POST', '/crop/export', { body })).json, { error: 'busy', jobId: 'job-x' });
  });
});

describe('parseCropPayload', () => {
  const base = { source: 'cache:clip-a', keyframes: KEYFRAMES, aspect: '16:9', size: '1920x1080', scaler: 'lanczos' };

  it('縦横比ごとのサイズ・拡大方法・キーフレームを allowlist で検証する', () => {
    assert.equal(parseCropPayload(base).width, 1920);
    for (const patch of [{ aspect: '4:3' }, { size: '1080x1920' }, { scaler: 'bicubic' }, { keyframes: [] }, { source: 1 }]) {
      assert.throws(() => parseCropPayload({ ...base, ...patch }), { status: 400 });
    }
    assert.throws(() => parseCropPayload(base, { requireAt: true }), /at/u);
    assert.equal(parseCropPayload({ ...base, at: 1.5 }, { requireAt: true }).at, 1.5);
  });
});

describe('crop の元動画の参照', () => {
  beforeEach(setup);
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('基底ディレクトリの外や不正な形式は解決しない', () => {
    for (const ref of ['cache:../x', 'public:a/b', 'upload:../../etc', 'upload:nope', 'file:/etc/passwd', 'cache:missing']) {
      assert.equal(resolveOutputFile(context, 'crop-source', ref), null, ref);
    }
    assert.equal(resolveOutputFile(context, 'crop-source', 'public:clip-a').size, 3);
  });

  it('書き出し名に使えない文字を落とし、アップロードは新しい順に残す', () => {
    assert.equal(safeStem('a/b:c'), 'a_b_c');
    assert.equal(safeStem('...'), 'video');
    const dir = path.join(root, 'uploads');
    fs.mkdirSync(dir);
    const ids = [1, 2, 3].map((n) => newUploadId(1700000000000 + n, () => n / 10));
    for (const [i, id] of ids.entries()) {
      fs.writeFileSync(path.join(dir, `${id}.mp4`), 'x');
      fs.writeFileSync(path.join(dir, `${id}.json`), '{}');
      fs.utimesSync(path.join(dir, `${id}.json`), 1000 + i, 1000 + i);
    }
    pruneUploads(dir, 2);
    assert.deepEqual(fs.readdirSync(dir).sort(), [ids[1], ids[2]].flatMap((id) => [`${id}.json`, `${id}.mp4`]).sort());
  });
});
