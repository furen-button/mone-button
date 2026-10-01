import {
  cacheEditorDir,
  outputDir,
  presetsDir,
  projectRoot,
  schemaPath,
} from '../lib/paths.js';
import { createClipRoutes } from './clips.js';
import { createFileRoutes } from './files.js';
import { createJobRoutes } from './jobs.js';
import { createPresetRoutes } from './presets.js';
import { createStillRoutes } from './still.js';
import { createValidateRoutes } from './validate.js';

export { shutdownJobs } from './jobs.js';

export function createHandlers(context = {}) {
  const resolvedContext = {
    projectRoot,
    presetsDir,
    outputDir,
    cacheDir: cacheEditorDir,
    schemaPath,
    ...context,
  };

  return [
    ...createPresetRoutes(resolvedContext),
    ...createValidateRoutes(resolvedContext),
    ...createClipRoutes(resolvedContext),
    ...createStillRoutes(resolvedContext),
    ...createJobRoutes(resolvedContext),
    ...createFileRoutes(resolvedContext),
  ];
}

export function matchRoute(routes, method, path) {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const match = route.pattern.exec(path);
    if (!match) {
      continue;
    }

    const params = {};
    for (const [key, value] of Object.entries(match.groups || {})) {
      params[key] = value;
    }
    return { route, params };
  }
  return null;
}
