import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createHandlers, matchRoute } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

function tempCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cv-editor-cache-'));
}

function readPreset(name) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/create-video', name), 'utf8'));
}

async function call(routes, method, target, body = undefined) {
  const url = new URL(target, 'http://localhost');
  const matched = matchRoute(routes, method, url.pathname);
  assert.notEqual(matched, null);

  return matched.route.handler({
    method,
    path: url.pathname,
    query: url.searchParams,
    body,
    headers: {},
    signal: new AbortController().signal,
  }, matched.params);
}

describe('validate handler', () => {
  it('writes scratch files and runs preflight for config-matome-01', async () => {
    const cacheDir = tempCacheDir();
    const routes = createHandlers({ cacheDir });
    const result = await call(routes, 'POST', '/validate', {
      name: 'config-matome-01.json',
      draft: readPreset('config-matome-01.json'),
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.validation.ok, true);
    assert.equal(result.json.preflight.clips.length, 99);
    assert.deepEqual(Object.keys(result.json.preflight.summary).sort(), ['error', 'info', 'warn']);
    assert.equal(fs.existsSync(path.resolve(projectRoot, result.json.scratch)), true);
  });

  it('keeps config validation ok when select.files points at a missing clip', async () => {
    const routes = createHandlers({ cacheDir: tempCacheDir() });
    const result = await call(routes, 'POST', '/validate', {
      name: 'config-files.json',
      draft: { select: { mode: 'files', files: ['nope'] } },
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.validation.ok, true);
    assert.match(result.json.selectError, /見つかりません/u);
    assert.equal(result.json.preflight, null);
  });

  it('returns loadConfig validation errors in the response body', async () => {
    const routes = createHandlers({ cacheDir: tempCacheDir() });
    const result = await call(routes, 'POST', '/validate', {
      name: 'config-video.json',
      draft: { select: { mode: 'videoId' } },
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.validation.ok, false);
    assert.equal(result.json.preflight, null);
    assert.equal(result.json.validation.errors.some((error) => error.includes('select.videoId')), true);
  });

  it('rejects forbidden draft keys', async () => {
    const routes = createHandlers({ cacheDir: tempCacheDir() });
    const result = await call(routes, 'POST', '/validate', {
      name: 'config-bad.json',
      draft: JSON.parse('{"__proto__":{"polluted":true}}'),
    });

    assert.equal(result.status, 400);
  });

  it('rejects traversal preset names', async () => {
    const routes = createHandlers({ cacheDir: tempCacheDir() });
    const result = await call(routes, 'POST', '/validate', {
      name: '../x.json',
      draft: {},
    });

    assert.equal(result.status, 400);
  });
});
