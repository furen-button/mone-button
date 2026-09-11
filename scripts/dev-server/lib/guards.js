import path from 'node:path';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PRESET_NAME_PATTERN = /^config(-[a-z0-9][a-z0-9-]{0,40})?\.json$/;
const OUTPUT_BASE_PATTERN = /^(?!\.)[\p{L}\p{N}_.\- ]{1,200}$/u;
const CLIP_BASE_PATTERN = /^[\w-]+$/;

export function checkLocalRequest({ method, remoteAddress, host, origin, secFetchSite, contentType }) {
  if (!LOOPBACK_ADDRESSES.has(String(remoteAddress || ''))) {
    return { ok: false, status: 403, reason: 'remote address is not loopback' };
  }

  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return { ok: false, status: 403, reason: 'origin host mismatch' };
      }
    } catch {
      return { ok: false, status: 403, reason: 'invalid origin' };
    }
  }

  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
    return { ok: false, status: 403, reason: 'cross-site request rejected' };
  }

  if (method === 'POST' && !String(contentType || '').startsWith('application/json')) {
    return { ok: false, status: 415, reason: 'content-type must be application/json' };
  }

  return { ok: true };
}

export function presetFileName(name, { allowDefault = true } = {}) {
  if (typeof name !== 'string' || name.includes('..') || name.includes('/')) {
    return null;
  }
  if (!PRESET_NAME_PATTERN.test(name)) {
    return null;
  }
  if (!allowDefault && name === 'config.json') {
    return null;
  }
  return name;
}

export function assertNoForbiddenKeys(value, label = 'payload') {
  visitValue(value, label, []);
}

export function assertSafePath(pathValue) {
  if (!Array.isArray(pathValue)) {
    throw new Error('path must be an array');
  }
  for (const [index, key] of pathValue.entries()) {
    if (typeof key !== 'string') {
      throw new Error(`path[${index}] must be a string`);
    }
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`path contains forbidden key at ['${key}']`);
    }
  }
}

export function outputBaseName(name) {
  if (typeof name !== 'string' || name.includes('..') || name.includes('/')) {
    return null;
  }
  if (path.basename(name) !== name || !OUTPUT_BASE_PATTERN.test(name)) {
    return null;
  }
  return name;
}

export function clipBase(name) {
  if (typeof name !== 'string' || !CLIP_BASE_PATTERN.test(name)) {
    return null;
  }
  return name;
}

function visitValue(value, label, pathParts) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      visitValue(item, label, [...pathParts, String(index)]);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      continue;
    }
    const nextPath = [...pathParts, key];
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`${label} contains forbidden key at ${formatPath(nextPath)}`);
    }
    visitValue(value[key], label, nextPath);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function formatPath(pathParts) {
  return `[${pathParts.map((part) => `'${part}'`).join(',')}]`;
}
