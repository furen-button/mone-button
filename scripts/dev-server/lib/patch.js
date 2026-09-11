import crypto from 'node:crypto';

const INTERNAL_KEYS = new Set(['__meta', 'titleOverride', '$schema']);

export function applyPatch(raw, patch) {
  const next = clone(raw);

  for (const entry of patch?.set || []) {
    setPath(next, entry.path, entry.value);
  }
  for (const path of patch?.unset || []) {
    unsetPath(next, path);
  }

  return next;
}

export function stripInternal(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => stripInternal(item));
  }
  if (!isPlainObject(obj)) {
    return clone(obj);
  }

  const next = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!INTERNAL_KEYS.has(key)) {
      next[key] = stripInternal(value);
    }
  }
  return next;
}

// プリセットの書式は JSON.stringify の 2 スペース + 末尾改行に固定する。
// 元ファイルの書式（1 行配列や 1.0 のような小数表記）は保たないため、
// 追跡中のプリセットは同じ書式で揃えておく（patch.test.js が全件を突き合わせる）。
export function serializePreset(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

export function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function setPath(target, path, value) {
  if (path.length === 0) {
    throw new Error('set path must not be empty');
  }

  let parent = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(parent[key])) {
      parent[key] = {};
    }
    parent = parent[key];
  }
  parent[path.at(-1)] = clone(value);
}

function unsetPath(target, path) {
  if (path.length === 0) {
    return;
  }

  let parent = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(parent[key])) {
      return;
    }
    parent = parent[key];
  }
  delete parent[path.at(-1)];
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
