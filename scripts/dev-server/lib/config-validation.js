import { loadConfig } from '../../create-video/config.js';

export function validateConfigFile(file) {
  try {
    loadConfig(['--config', file]);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: errorsFromConfigError(error) };
  }
}

export function errorsFromConfigError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split('\n')
    .map((line) => line.replace(/^- /u, ''))
    .filter((line) => line.length > 0);
}
