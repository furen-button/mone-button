import crypto from 'node:crypto';

const INTERNAL_KEYS = new Set(['__meta', 'titleOverride', '$schema']);
const DECIMAL_NUMBER_PATHS = new Set([
  'cards.duration',
  'endcaps.opening.duration',
  'endcaps.ending.duration',
  'effects.zoom.minDuration',
  'effects.zoom.analysis.minProminence',
  'effects.zoom.analysis.silenceFloor',
]);

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

export function serializePreset(obj) {
  return `${stringifyPreset(obj, 0, [])}\n`;
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

function stringifyPreset(value, depth, path) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const indent = ' '.repeat(depth);
    const nextIndent = ' '.repeat(depth + 2);
    const items = value.map((item, index) => `${nextIndent}${stringifyPreset(item, depth + 2, [...path, String(index)])}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    const indent = ' '.repeat(depth);
    const nextIndent = ' '.repeat(depth + 2);
    const items = entries.map(([key, item]) => {
      return `${nextIndent}${JSON.stringify(key)}: ${stringifyPreset(item, depth + 2, [...path, key])}`;
    });
    return `{\n${items.join(',\n')}\n${indent}}`;
  }

  if (typeof value === 'number') {
    return formatNumber(value, path);
  }

  return JSON.stringify(value);
}

function formatNumber(value, path) {
  if (!Number.isFinite(value)) {
    return 'null';
  }
  if (Number.isInteger(value) && shouldKeepDecimal(path)) {
    return `${value}.0`;
  }
  return JSON.stringify(value);
}

function shouldKeepDecimal(path) {
  if (path.length === 3 && path[0] === 'bgm' && path[1] === 'fade') {
    return true;
  }
  return DECIMAL_NUMBER_PATHS.has(path.join('.'));
}
