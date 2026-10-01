import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertNoForbiddenKeys,
  assertSafePath,
  checkLocalRequest,
  clipBase,
  outputBaseName,
  presetFileName,
} from './guards.js';

function request(overrides = {}) {
  return {
    method: 'GET',
    remoteAddress: '127.0.0.1',
    host: 'localhost:5199',
    origin: undefined,
    secFetchSite: undefined,
    contentType: undefined,
    ...overrides,
  };
}

describe('checkLocalRequest', () => {
  it('loopback address variants are accepted', () => {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      assert.deepEqual(checkLocalRequest(request({ remoteAddress })), { ok: true });
    }
  });

  it('rejects non-loopback addresses', () => {
    assert.deepEqual(checkLocalRequest(request({ remoteAddress: '10.0.0.5' })), {
      ok: false,
      status: 403,
      reason: 'remote address is not loopback',
    });
  });

  it('rejects origin host mismatch', () => {
    assert.equal(checkLocalRequest(request({ origin: 'http://evil.example' })).status, 403);
  });

  it('rejects cross-site fetches and accepts same-origin', () => {
    assert.equal(checkLocalRequest(request({ secFetchSite: 'cross-site' })).status, 403);
    assert.deepEqual(checkLocalRequest(request({ secFetchSite: 'same-origin' })), { ok: true });
  });

  it('requires json content-type for POST', () => {
    assert.equal(checkLocalRequest(request({ method: 'POST', contentType: 'text/plain' })).status, 415);
    assert.deepEqual(checkLocalRequest(request({ method: 'POST', contentType: 'application/json; charset=utf-8' })), {
      ok: true,
    });
  });
});

describe('presetFileName', () => {
  it('accepts valid preset names', () => {
    assert.equal(presetFileName('config-matome-02.json'), 'config-matome-02.json');
    assert.equal(presetFileName('config.json'), 'config.json');
    assert.equal(presetFileName('config.json', { allowDefault: false }), null);
  });

  it('rejects invalid preset names', () => {
    for (const name of [
      'config-.json',
      'Config-A.json',
      'config-a/b.json',
      '../config-a.json',
      `config-${'a'.repeat(42)}.json`,
    ]) {
      assert.equal(presetFileName(name), null);
    }
  });
});

describe('forbidden key guards', () => {
  it('rejects forbidden keys with payload paths', () => {
    assert.throws(
      () => assertNoForbiddenKeys(JSON.parse('{"telops":{"title":{"__proto__":{"x":1}}}}'), 'patch'),
      /patch.*\['telops','title','__proto__'\]/u,
    );
  });

  it('rejects forbidden path entries', () => {
    assert.throws(() => assertSafePath(['telops', '__proto__', 'x']), /forbidden key/u);
  });
});

describe('future filename guards', () => {
  it('accepts Japanese output names and rejects path traversal', () => {
    assert.equal(outputBaseName('まとめ 動画_01-完成'), 'まとめ 動画_01-完成');
    assert.equal(outputBaseName('..'), null);
  });

  it('accepts simple clip bases only', () => {
    assert.equal(clipBase('clip_01-a'), 'clip_01-a');
    assert.equal(clipBase('clip/01'), null);
  });
});
