import { outputBaseName, presetFileName } from './guards.js';

// GUI からは生の argv を受け取らず、allowlist の JSON を argv に変換する。
// シェルを通さない（spawn に配列で渡す）ので補間の問題は無いが、未知のフラグや
// 任意パスを createVideo に渡せないようにここで絞る。
const BOOL_FLAGS = {
  cards: 'cards',
  bgm: 'bgm',
  zoom: 'zoom',
  enhance: 'enhance',
  avoidFace: 'avoid-face',
  title: 'title',
  date: 'date',
  serif: 'serif',
  time: 'time',
  progress: 'progress',
  opening: 'opening',
  ending: 'ending',
};
const KNOWN_OPTIONS = new Set(['limit', 'qc', 'contact', 'source', 'titleText', 'resolution', 'out', ...Object.keys(BOOL_FLAGS)]);
const SOURCES = new Set(['existing', 'cache']);

export function presetConfigArg(name) {
  const safeName = presetFileName(name);
  if (!safeName) {
    throw new Error('invalid preset name');
  }
  return `scripts/create-video/${safeName}`;
}

export function buildArgv(name, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) {
      throw new Error(`unknown build option: ${key}`);
    }
  }

  const argv = ['--config', presetConfigArg(name)];

  if (options.limit !== undefined && options.limit !== null && options.limit !== '') {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 999) {
      throw new Error('limit must be an integer between 1 and 999');
    }
    argv.push('--limit', String(limit));
  }

  // --contact は index.js で --qc 配下でしか効かないので、contact が付いたら qc も強制する。
  if (options.qc === true || options.contact === true) {
    argv.push('--qc');
  }
  if (options.contact === true) {
    argv.push('--contact');
  }

  if (options.source !== undefined) {
    if (!SOURCES.has(options.source)) {
      throw new Error('source must be existing or cache');
    }
    argv.push('--source', options.source);
  }

  for (const [key, flag] of Object.entries(BOOL_FLAGS)) {
    const value = options[key];
    if (value === undefined) {
      continue;
    }
    if (value === true) {
      argv.push(`--${flag}`);
    } else if (value === false) {
      argv.push(`--no-${flag}`);
    } else {
      throw new Error(`${key} must be a boolean`);
    }
  }

  if (options.titleText !== undefined) {
    if (typeof options.titleText !== 'string' || options.titleText.length > 200) {
      throw new Error('titleText must be a string of 200 chars or less');
    }
    argv.push('--title', options.titleText);
  }

  if (options.resolution !== undefined) {
    if (!/^\d{2,4}x\d{2,4}$/u.test(String(options.resolution))) {
      throw new Error('resolution must be WxH');
    }
    argv.push('--resolution', String(options.resolution));
  }

  if (options.out !== undefined) {
    const base = outputBaseName(String(options.out));
    if (!base || !base.endsWith('.mp4')) {
      throw new Error('out must be a basename ending with .mp4');
    }
    argv.push('--out', `output/${base}`);
  }

  return argv;
}

export function qcArgv(name, video, { contact = false } = {}) {
  const base = outputBaseName(video);
  if (!base) {
    throw new Error('invalid video name');
  }
  const argv = ['--video', `output/${base}.mp4`, '--config', presetConfigArg(name)];
  if (contact === true) {
    argv.push('--contact');
  }
  return argv;
}
