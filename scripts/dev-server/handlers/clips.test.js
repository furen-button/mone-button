import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createHandlers, matchRoute } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

function readPreset(name) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/create-video', name), 'utf8'));
}

async function post(routes, target, body) {
  const url = new URL(target, 'http://localhost');
  const matched = matchRoute(routes, 'POST', url.pathname);
  assert.notEqual(matched, null);
  return matched.route.handler({ method: 'POST', path: url.pathname, query: url.searchParams, body, headers: {}, signal: new AbortController().signal }, matched.params);
}

describe('clips handler', () => {
  it('files モードのプリセットはビルド順そのままを返し、カタログは全クリップを含む', async () => {
    const routes = createHandlers();
    const result = await post(routes, '/clips', { draft: readPreset('config-matome-01.json') });
    assert.equal(result.status, 200);
    assert.equal(result.json.clips.length, 99);
    assert.equal(result.json.error, undefined);
    assert.equal(result.json.catalog.clips.length, fs.readdirSync(path.join(projectRoot, 'public/data')).filter((f) => f.endsWith('.json')).length);
    assert.ok(result.json.catalog.categories.length > 0);
    assert.ok(result.json.catalog.videoIds.length > 0);
    const first = result.json.clips[0];
    assert.deepEqual(Object.keys(first.source), ['existing', 'cache']);
    assert.equal(typeof first.title, 'string');
  });

  it('files の不明エントリは error、対象 0 件は warning にする', async () => {
    const routes = createHandlers();
    const missing = await post(routes, '/clips', { draft: { select: { mode: 'files', files: ['nope'] } } });
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.json.clips, []);
    assert.match(missing.json.error, /見つかりません/u);

    const empty = await post(routes, '/clips', { draft: { select: { mode: 'videoId', videoId: 'zzzzzzzzzzz' } } });
    assert.deepEqual(empty.json.clips, []);
    assert.match(empty.json.warning, /見つかりません/u);
    assert.equal(empty.json.error, undefined);
  });

  it('不正な body と禁止キーは 400', async () => {
    const routes = createHandlers();
    assert.equal((await post(routes, '/clips', { draft: 1 })).status, 400);
    assert.equal((await post(routes, '/clips', { draft: { __proto__: { x: 1 } } })).status, 400);
  });
});
