import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { parseRange, resolveOutputFile } from './files.js';
import { createHandlers, matchRoute } from './index.js';

function tempContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-files-'));
  const outputDir = path.join(root, 'output');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(path.join(outputDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(cacheDir, 'stills'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'sample.mp4'), Buffer.from('0123456789'));
  fs.writeFileSync(path.join(outputDir, 'sample.youtube.txt'), 'desc');
  fs.writeFileSync(path.join(outputDir, 'sample.comment-1.txt'), 'c1');
  fs.writeFileSync(path.join(outputDir, 'sample.comment-2.txt'), 'c2');
  fs.writeFileSync(path.join(outputDir, 'sample.qc.json'), JSON.stringify({ summary: { error: 0, warn: 1, info: 2 }, results: [] }));
  fs.writeFileSync(path.join(outputDir, 'sample.render.json'), JSON.stringify({ clipCount: 3, totalSec: 12.5, concatMethod: 'concat-vcopy' }));
  return { projectRoot: root, presetsDir: root, outputDir, cacheDir, schemaPath: path.join(root, 'schema.json') };
}

async function get(routes, target, headers = {}, method = 'GET') {
  const url = new URL(target, 'http://localhost');
  const matched = matchRoute(routes, method, url.pathname);
  assert.notEqual(matched, null);
  return matched.route.handler({ method, path: url.pathname, query: url.searchParams, body: undefined, headers, signal: new AbortController().signal }, matched.params);
}

describe('resolveOutputFile', () => {
  it('kind ごとの基底ディレクトリと拡張子に固定し、外へ出る名前は拒否する', () => {
    const context = tempContext();
    assert.equal(resolveOutputFile(context, 'mp4', 'sample').contentType, 'video/mp4');
    assert.equal(resolveOutputFile(context, 'youtube', 'sample').contentType, 'text/plain; charset=utf-8');
    assert.ok(resolveOutputFile(context, 'comment', 'sample', 2).path.endsWith('sample.comment-2.txt'));
    assert.equal(resolveOutputFile(context, 'comment', 'sample', 0), null);
    assert.equal(resolveOutputFile(context, 'mp4', '../package.json'), null);
    assert.equal(resolveOutputFile(context, 'etc', 'passwd'), null);
    assert.equal(resolveOutputFile(context, 'mp4', 'missing'), null);
    assert.equal(resolveOutputFile(context, 'thumb', '../x'), null);
    assert.equal(resolveOutputFile(context, 'still', 'not-a-hash'), null);
  });
});

describe('parseRange', () => {
  it('bytes=a-b / a- / -n を解釈し、範囲外は invalid', () => {
    assert.deepEqual(parseRange('bytes=0-3', 10), { start: 0, end: 3 });
    assert.deepEqual(parseRange('bytes=4-', 10), { start: 4, end: 9 });
    assert.deepEqual(parseRange('bytes=-2', 10), { start: 8, end: 9 });
    assert.deepEqual(parseRange('bytes=0-99', 10), { start: 0, end: 9 });
    assert.deepEqual(parseRange('bytes=10-', 10), { invalid: true });
    assert.deepEqual(parseRange('bytes=-', 10), { invalid: true });
    assert.equal(parseRange(undefined, 10), null);
  });
});

describe('file routes', () => {
  it('Range 付きは 206、範囲外は 416、HEAD も同じヘッダ', async () => {
    const context = tempContext();
    const routes = createHandlers(context);
    const full = await get(routes, '/file?kind=mp4&name=sample');
    assert.equal(full.status, 200);
    assert.equal(full.length, 10);
    assert.equal(full.headers['Accept-Ranges'], 'bytes');
    full.stream.destroy();

    const partial = await get(routes, '/file?kind=mp4&name=sample', { range: 'bytes=2-5' });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['Content-Range'], 'bytes 2-5/10');
    assert.equal(partial.length, 4);
    partial.stream.destroy();

    const bad = await get(routes, '/file?kind=mp4&name=sample', { range: 'bytes=99-' });
    assert.equal(bad.status, 416);

    const head = await get(routes, '/file?kind=mp4&name=sample', {}, 'HEAD');
    assert.equal(head.status, 200);
    head.stream.destroy();

    assert.equal((await get(routes, '/file?kind=mp4&name=../x')).status, 400);
  });

  it('/outputs と /result が sidecar の有無と本文を返す', async () => {
    const context = tempContext();
    const routes = createHandlers(context);
    const outputs = await get(routes, '/outputs');
    assert.equal(outputs.json.length, 1);
    assert.equal(outputs.json[0].base, 'sample');
    assert.deepEqual(outputs.json[0].sidecars.comments, ['sample.comment-1.txt', 'sample.comment-2.txt']);
    assert.equal(outputs.json[0].sidecars.qcJson, true);
    assert.equal(outputs.json[0].sidecars.contact, false);

    const result = await get(routes, '/result?name=sample');
    assert.equal(result.status, 200);
    assert.equal(result.json.youtube, 'desc');
    assert.deepEqual(result.json.comments, ['c1', 'c2']);
    assert.deepEqual(result.json.qc.summary, { error: 0, warn: 1, info: 2 });
    assert.equal(result.json.render.concatMethod, 'concat-vcopy');
    assert.equal(result.json.qcMd, null);
    assert.equal((await get(routes, '/result?name=../x')).status, 400);
  });
});
