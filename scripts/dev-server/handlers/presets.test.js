import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createHandlers, matchRoute } from './index.js';
import { hashText } from '../lib/patch.js';

function tempPresetsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cv-presets-'));
}

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

describe('preset handlers', () => {
  it('creates an empty preset as a two-space JSON file with trailing newline', async () => {
    const dir = tempPresetsDir();
    const routes = createHandlers({ presetsDir: dir });

    const result = await call(routes, 'POST', '/preset', {
      mode: 'create',
      name: 'config-new.json',
      base: null,
      patch: { set: [], unset: [] },
    });

    assert.equal(result.status, 201);
    assert.equal(fs.readFileSync(path.join(dir, 'config-new.json'), 'utf8'), '{}\n');
    assert.equal(result.json.created, true);
    assert.equal(result.json.validation.ok, false);
    assert.equal(result.json.text.endsWith('\n'), true);
  });

  it('creates from a base preset and applies patch', async () => {
    const dir = tempPresetsDir();
    writeJson(dir, 'config-base.json', { select: { mode: 'files', files: ['a'] }, output: { name: 'base.mp4' } });
    const routes = createHandlers({ presetsDir: dir });

    const result = await call(routes, 'POST', '/preset', {
      mode: 'create',
      name: 'config-derived.json',
      base: 'config-base.json',
      patch: { set: [{ path: ['output', 'name'], value: 'derived.mp4' }], unset: [] },
    });

    assert.equal(result.status, 201);
    assert.deepEqual(result.json.raw, {
      select: { mode: 'files', files: ['a'] },
      output: { name: 'derived.mp4' },
    });
  });

  it('rejects duplicate create without overwrite', async () => {
    const dir = tempPresetsDir();
    writeJson(dir, 'config-new.json', {});
    const routes = createHandlers({ presetsDir: dir });

    const result = await call(routes, 'POST', '/preset', {
      mode: 'create',
      name: 'config-new.json',
      base: null,
      patch: { set: [], unset: [] },
    });

    assert.equal(result.status, 409);
  });

  it('returns 404 for updating missing presets', async () => {
    const routes = createHandlers({ presetsDir: tempPresetsDir() });

    const result = await call(routes, 'POST', '/preset', {
      mode: 'update',
      name: 'config-missing.json',
      patch: { set: [], unset: [] },
    });

    assert.equal(result.status, 404);
  });

  it('returns current text when ifMatch does not match', async () => {
    const dir = tempPresetsDir();
    writeJson(dir, 'config-new.json', { select: { mode: 'videoId' } });
    const text = fs.readFileSync(path.join(dir, 'config-new.json'), 'utf8');
    const routes = createHandlers({ presetsDir: dir });

    const result = await call(routes, 'POST', '/preset', {
      mode: 'update',
      name: 'config-new.json',
      ifMatch: 'deadbeef',
      patch: { set: [], unset: [] },
    });

    assert.equal(result.status, 412);
    assert.deepEqual(result.json.current, {
      raw: { select: { mode: 'videoId' } },
      text,
      hash: hashText(text),
    });
  });

  it('lists invalid JSON with null summary', async () => {
    const dir = tempPresetsDir();
    writeJson(dir, 'config-valid.json', { select: { mode: 'files', files: ['a', 'b'] }, output: { name: 'out.mp4' } });
    fs.writeFileSync(path.join(dir, 'config-broken.json'), '{', 'utf8');
    const routes = createHandlers({ presetsDir: dir });

    const result = await call(routes, 'GET', '/presets');

    assert.equal(result.status, 200);
    assert.deepEqual(result.json.map((preset) => [preset.name, preset.summary?.count ?? null]), [
      ['config-broken.json', null],
      ['config-valid.json', 2],
    ]);
  });

  it('rejects forbidden paths and traversal names', async () => {
    const dir = tempPresetsDir();
    writeJson(dir, 'config.json', {});
    const routes = createHandlers({ presetsDir: dir });

    const forbidden = await call(routes, 'POST', '/preset', {
      mode: 'update',
      name: 'config.json',
      patch: { set: [{ path: ['__proto__', 'x'], value: 1 }], unset: [] },
    });
    const traversal = await call(routes, 'POST', '/preset', {
      mode: 'create',
      name: '../evil.json',
      patch: { set: [], unset: [] },
    });

    assert.equal(forbidden.status, 400);
    assert.equal(traversal.status, 400);
  });
});
