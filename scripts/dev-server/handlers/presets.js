import fs from 'node:fs';
import path from 'node:path';

import { ALIGN, DEFAULTS, deepMerge } from '../../create-video/config.js';
import { assertNoForbiddenKeys, assertSafePath, presetFileName } from '../lib/guards.js';
import { validateConfigFile } from '../lib/config-validation.js';
import { applyPatch, hashText, serializePreset, stripInternal } from '../lib/patch.js';

export function createPresetRoutes(context) {
  return [
    { method: 'GET', pattern: /^\/schema$/u, handler: async () => getSchema(context) },
    { method: 'GET', pattern: /^\/presets$/u, handler: async () => listPresets(context) },
    { method: 'GET', pattern: /^\/preset$/u, handler: async (req) => getPreset(context, req.query.get('name')) },
    { method: 'POST', pattern: /^\/preset$/u, handler: async (req) => savePreset(context, req.body) },
  ];
}

async function getSchema(context) {
  const schema = JSON.parse(fs.readFileSync(context.schemaPath, 'utf8'));
  return {
    status: 200,
    json: {
      schema,
      defaults: structuredClone(DEFAULTS),
      align: Object.keys(ALIGN),
      presetsDir: 'scripts/create-video',
    },
  };
}

async function listPresets(context) {
  const presets = fs
    .readdirSync(context.presetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && presetFileName(entry.name) !== null)
    .map((entry) => presetSummary(context, entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { status: 200, json: presets };
}

async function getPreset(context, name) {
  const safeName = presetFileName(name);
  if (!safeName) {
    return jsonError(400, 'invalid preset name');
  }

  const file = presetPath(context, safeName);
  if (!fs.existsSync(file)) {
    return jsonError(404, 'preset not found');
  }

  return { status: 200, json: readPresetResponse(safeName, file) };
}

async function savePreset(context, body) {
  try {
    const payload = parseSavePayload(body);
    const safeName = presetFileName(payload.name, { allowDefault: payload.mode !== 'create' });
    if (!safeName) {
      return jsonError(400, 'invalid preset name');
    }

    const file = presetPath(context, safeName);
    if (payload.mode === 'update' && !fs.existsSync(file)) {
      return jsonError(404, 'preset not found');
    }
    if (payload.mode === 'create' && fs.existsSync(file) && payload.overwrite !== true) {
      return jsonError(409, 'preset already exists');
    }

    if (payload.mode === 'update' && payload.ifMatch) {
      const current = readPresetFile(file);
      if (current.hash !== payload.ifMatch) {
        return {
          status: 412,
          json: {
            error: 'preset_changed',
            current: { raw: current.raw, text: current.text, hash: current.hash },
          },
        };
      }
    }

    const baseRaw = payload.mode === 'create' ? readBasePreset(context, payload.base) : readPresetFile(file).raw;
    const nextRaw = stripInternal(applyPatch(baseRaw, payload.patch));
    fs.writeFileSync(file, serializePreset(nextRaw), 'utf8');

    return {
      status: payload.mode === 'create' ? 201 : 200,
      json: {
        ...readPresetResponse(safeName, file),
        ...(payload.mode === 'create' ? { created: true } : {}),
      },
    };
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }
}

function parseSavePayload(body) {
  if (!isPlainObject(body)) {
    throw new Error('body must be an object');
  }

  const mode = body.mode;
  if (mode !== 'update' && mode !== 'create') {
    throw new Error('mode must be update or create');
  }

  const patch = normalizePatch(body.patch);
  return {
    mode,
    name: body.name,
    ifMatch: typeof body.ifMatch === 'string' ? body.ifMatch : undefined,
    base: body.base === null || typeof body.base === 'string' ? body.base : undefined,
    overwrite: body.overwrite === true,
    patch,
  };
}

function normalizePatch(patch) {
  if (!isPlainObject(patch)) {
    throw new Error('patch must be an object');
  }
  assertNoForbiddenKeys(patch, 'patch');

  const set = Array.isArray(patch.set) ? patch.set : [];
  const unset = Array.isArray(patch.unset) ? patch.unset : [];
  if (set.length > 500) {
    throw new Error('patch.set length must be 500 or less');
  }

  for (const entry of set) {
    if (!isPlainObject(entry)) {
      throw new Error('patch.set entries must be objects');
    }
    assertSafePath(entry.path);
  }
  for (const pathSegments of unset) {
    assertSafePath(pathSegments);
  }

  return { set, unset };
}

function readBasePreset(context, baseName) {
  if (!baseName) {
    return {};
  }

  const safeBaseName = presetFileName(baseName);
  if (!safeBaseName) {
    throw new Error('invalid base preset name');
  }

  const file = presetPath(context, safeBaseName);
  if (!fs.existsSync(file)) {
    throw new Error('base preset not found');
  }

  return readPresetFile(file).raw;
}

function presetSummary(context, name) {
  const file = presetPath(context, name);
  const stat = fs.statSync(file);
  let summary = null;
  try {
    summary = summarizePreset(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    summary = null;
  }

  return { name, mtimeMs: stat.mtimeMs, size: stat.size, summary };
}

function summarizePreset(raw) {
  const mode = raw?.select?.mode ?? null;
  return {
    mode,
    count: countForMode(raw?.select, mode),
    outputName: raw?.output?.name ?? null,
    resolution: raw?.output?.resolution ?? null,
  };
}

function countForMode(select, mode) {
  if (mode === 'files') {
    return Array.isArray(select?.files) ? select.files.length : 0;
  }
  if (mode === 'category') {
    return Array.isArray(select?.categories) ? select.categories.length : 0;
  }
  if (mode === 'videoId') {
    return 1;
  }
  return null;
}

function readPresetResponse(name, file) {
  const { raw, text, hash, mtimeMs } = readPresetFile(file);
  return {
    name,
    raw,
    text,
    hash,
    mtimeMs,
    resolved: deepMerge(structuredClone(DEFAULTS), raw),
    validation: validateConfigFile(file),
  };
}

function readPresetFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const stat = fs.statSync(file);
  return {
    raw: JSON.parse(text),
    text,
    hash: hashText(text),
    mtimeMs: stat.mtimeMs,
  };
}

function presetPath(context, name) {
  return path.join(context.presetsDir, name);
}

function jsonError(status, error) {
  return { status, json: { error } };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
