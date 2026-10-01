import fs from 'node:fs';
import path from 'node:path';

import { presetFileName } from './guards.js';
import { stripInternal } from './patch.js';

export function writeScratch({ cacheDir, name, draft }) {
  const safeName = presetFileName(name);
  if (!safeName) {
    throw new Error('invalid preset name');
  }

  const presetBase = safeName.replace(/\.json$/u, '');
  fs.mkdirSync(cacheDir, { recursive: true });
  const scratchPath = path.join(cacheDir, `${presetBase}.draft.json`);
  const tmpPath = `${scratchPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(stripInternal(draft), null, 2), 'utf8');
  fs.renameSync(tmpPath, scratchPath);
  return scratchPath;
}
