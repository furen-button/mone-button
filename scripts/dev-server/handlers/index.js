import {
  cacheEditorDir,
  outputDir,
  presetsDir,
  projectRoot,
  schemaPath,
} from '../lib/paths.js';
import { createClipRoutes } from './clips.js';
import { createCropRoutes } from './crop.js';
import { createFileRoutes } from './files.js';
import { JobManager, createJobRoutes } from './jobs.js';
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

  // ビルドと切り出しの書き出しは同じ JobManager に載せ、/build/<id>/log・cancel から両方を見られるようにする。
  // ジョブは 1 本ずつなので、片方の実行中にもう片方を始めると 409 になる。
  const jobs = new JobManager(resolvedContext);
  return [
    ...createPresetRoutes(resolvedContext),
    ...createValidateRoutes(resolvedContext),
    ...createClipRoutes(resolvedContext),
    ...createStillRoutes(resolvedContext),
    ...createJobRoutes(resolvedContext, jobs),
    ...createCropRoutes(resolvedContext, jobs),
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
