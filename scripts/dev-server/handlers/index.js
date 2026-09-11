import {
  cacheEditorDir,
  outputDir,
  presetsDir,
  projectRoot,
  schemaPath,
} from '../lib/paths.js';
import { createPresetRoutes } from './presets.js';

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
