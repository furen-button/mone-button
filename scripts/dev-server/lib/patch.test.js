import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { applyPatch, hashText, serializePreset, stripInternal } from './patch.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../..');

describe('applyPatch', () => {
  it('keeps untouched keys and key order', () => {
    const raw = { a: 1, b: { x: 2 }, c: 3 };
    const next = applyPatch(raw, {
      set: [{ path: ['b', 'y'], value: 4 }],
      unset: [],
    });

    assert.deepEqual(Object.keys(next), ['a', 'b', 'c']);
    assert.deepEqual(Object.keys(next.b), ['x', 'y']);
    assert.deepEqual(raw, { a: 1, b: { x: 2 }, c: 3 });
  });

  it('replaces arrays as whole values', () => {
    const next = applyPatch({ select: { files: ['a', 'b'] } }, {
      set: [{ path: ['select', 'files'], value: ['c'] }],
      unset: [],
    });

    assert.deepEqual(next.select.files, ['c']);
  });

  it('creates intermediate plain objects', () => {
    const next = applyPatch({}, {
      set: [{ path: ['telops', 'title', 'marginH'], value: 0.16 }],
      unset: [],
    });

    assert.deepEqual(next, { telops: { title: { marginH: 0.16 } } });
  });

  it('leaves empty parents after unset', () => {
    const next = applyPatch({ telops: { title: { marginH: 0.16 } } }, {
      set: [],
      unset: [['telops', 'title', 'marginH']],
    });

    assert.deepEqual(next, { telops: { title: {} } });
  });
});

describe('stripInternal', () => {
  it('removes internal keys recursively and keeps unknown keys', () => {
    assert.deepEqual(stripInternal({
      __meta: { configPath: 'x' },
      $schema: 'schema',
      titleOverride: 'title',
      unknown: true,
      nested: { __meta: 1, kept: 2 },
    }), {
      unknown: true,
      nested: { kept: 2 },
    });
  });
});

describe('serializePreset', () => {
  it('preserves existing config-mone.json text after an empty patch', () => {
    const file = path.join(projectRoot, 'scripts/create-video/config-mone.json');
    const text = fs.readFileSync(file, 'utf8');
    const raw = JSON.parse(text);

    assert.equal(serializePreset(applyPatch(raw, { set: [], unset: [] })), text);
  });

  it('adds a trailing newline and hashes text as sha1 hex', () => {
    const text = serializePreset({});
    assert.equal(text, '{}\n');
    assert.match(hashText(text), /^[0-9a-f]{40}$/u);
  });
});
