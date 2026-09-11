import path from 'node:path';

import { DEFAULTS, deepMerge } from '../../create-video/config.js';
import { runPreflight } from '../../create-video/qc/index.js';
import { summarizeResults } from '../../create-video/qc/report.js';
import { assertNoForbiddenKeys, presetFileName } from '../lib/guards.js';
import { writeScratch } from '../lib/scratch.js';
import { validateConfigFile } from '../lib/config-validation.js';

export function createValidateRoutes(context) {
  return [
    { method: 'POST', pattern: /^\/validate$/u, handler: async (req) => validateDraft(context, req.body) },
  ];
}

async function validateDraft(context, body) {
  const startedAt = Date.now();
  try {
    const payload = parseValidatePayload(body);
    const scratch = writeScratch({ cacheDir: context.cacheDir, name: payload.name, draft: payload.draft });
    const validation = validateConfigFile(scratch);
    const resolved = deepMerge(structuredClone(DEFAULTS), payload.draft);
    let preflight = null;
    let selectError;

    if (validation.ok) {
      try {
        // runPreflight が内部で loadConfig → collectClips → runStaticChecks を通す。
        // collectClips の throw（対象 0 件・files の不明エントリ）は検証エラーではなく selectError として返す。
        const preflightResult = runPreflight(['--config', scratch]);
        preflight = {
          clips: preflightResult.clips.map((clip) => ({
            base: clip.base,
            videoId: clip.videoId,
            duration: clip.duration,
            serif: clip.data.serif ?? '',
          })),
          results: preflightResult.results,
          summary: summarizeResults(preflightResult.results),
          exitCode: preflightResult.exitCode,
        };
      } catch (error) {
        selectError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      status: 200,
      json: {
        validation,
        resolved,
        preflight,
        ...(selectError ? { selectError } : {}),
        scratch: path.relative(context.projectRoot, scratch),
        ms: Date.now() - startedAt,
      },
    };
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : String(error));
  }
}

function parseValidatePayload(body) {
  if (!isPlainObject(body)) {
    throw new Error('body must be an object');
  }

  const safeName = presetFileName(body.name);
  if (!safeName) {
    throw new Error('invalid preset name');
  }
  if (!isPlainObject(body.draft)) {
    throw new Error('draft must be an object');
  }
  assertNoForbiddenKeys(body.draft, 'draft');

  return { name: safeName, draft: body.draft };
}

function jsonError(status, error) {
  return { status, json: { error } };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
