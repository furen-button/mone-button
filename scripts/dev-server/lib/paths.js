import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(moduleDir, '../../..');
export const presetsDir = path.join(projectRoot, 'scripts/create-video');
export const outputDir = path.join(projectRoot, 'output');
export const cacheEditorDir = path.join(projectRoot, 'cache/createVideo/editor');
export const schemaPath = path.join(projectRoot, 'scripts/create-video/config.schema.json');
