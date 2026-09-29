import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(__filename);
export const projectRoot = path.resolve(moduleDir, '../..');

export const ALIGN = {
  'top-left': 7,
  'top-center': 8,
  'top-right': 9,
  'middle-left': 4,
  center: 5,
  'middle-right': 6,
  'bottom-left': 1,
  'bottom-center': 2,
  'bottom-right': 3,
};

export const DEFAULTS = {
  select: {
    mode: 'videoId',
    videoId: null,
    categories: [],
    files: [],
    exclude: [],
    order: 'date',
    limit: null,
  },
  output: {
    dir: 'output',
    name: null,
    resolution: '1280x720',
    fps: 30,
  },
  source: 'existing',
  normalizeCache: true,
  font: 'Hiragino Sans',
  fontsDir: '/System/Library/Fonts',
  telops: {
    title: {
      enabled: true,
      align: 'top-center',
      size: 0.03,
      font: null,
      autoShrink: true,
      minSize: 0.02,
      maxHeight: 0.09,
      marginH: 0.035,
      text: null,
      overrides: {},
      color: 'FFFFFF',
      box: { enabled: true, fill: '2E9B0E', pad: 12 },
      fade: [200, 200],
    },
    date: {
      enabled: true,
      align: 'top-right',
      size: 0.03,
      font: null,
      color: 'FFFFFF',
    },
    time: {
      enabled: true,
      align: 'bottom-right',
      size: 0.042,
      font: null,
      color: 'FFFFFF',
    },
    serif: {
      enabled: true,
      align: 'bottom-center',
      size: 0.08,
      font: null,
      autoShrink: true,
      minSize: 0.05,
      maxHeight: 0.3,
      color: '2020D0',
      bold: true,
      box: {
        enabled: true,
        fill: 'FFFFFF',
        border: '0000CC',
        borderWidth: 6,
        pad: 10,
        radius: 16,
        opacity: 1,
      },
      shadow: 2,
      fade: [150, 150],
      karaoke: false,
      // 顔検出でセリフボックスが演者の顔と重なるクリップだけ、顔の無い側へ寄せて幅を狭める。
      // gap は顔との間隔、minWidth は狭めたボックスの幅の下限（いずれも画面幅に対する割合）。
      // 下限を満たせないときは従来どおり全幅にし、QC が warn で知らせる。
      avoidFace: {
        enabled: true,
        gap: 0.0125,
        minWidth: 0.45,
        frames: 3,
      },
    },
    progress: {
      enabled: true,
      align: 'top-left',
      size: 0.028,
      font: null,
      color: 'FFFFFF',
      format: '{i} / {n}',
      bar: true,
    },
  },
  cards: {
    enabled: true,
    position: 'before',
    duration: 1.5,
    // カード内テキスト（番号/タイトル/次のセリフ/情報）の既定フォント。null でグローバル font を使用。
    // 各ブロックの font を個別指定すればそちらが優先される。
    font: null,
    // カードの nextSerif 用スタイル上書き。telops.serif を継承し、ここに書いた差分だけ効く。
    // marginH/marginV は幅・高さに対する割合で位置も別指定できる（既定 0.08）。
    serif: {},
    background: {
      type: 'video',
      video: 'assets/create-video/5bg191クロスするハート背景.mp4',
      image: null,
      color: '0E7A34',
      gradient: { c0: '0E7A34', c1: '064D20' },
    },
    thumbnail: { enabled: true, y: 180, width: 760 },
    show: {
      index: true,
      nextSerif: true,
      title: true,
      date: true,
      uploader: true,
      sourceUrl: false,
    },
    index: {
      align: 'top-right',
      size: 0.12,
      font: null,
      color: 'FFFFFF',
      prefix: '',
      suffix: '',
    },
    se: {
      enabled: true,
      file: 'assets/create-video/パッ.mp3',
      fadeOut: 0.3,
    },
  },
  bgm: {
    enabled: false,
    file: 'assets/create-video/kamatamago_C00003_heaven-and-hell.mp3',
    volume: 0.15,
    fade: [1.0, 2.0],
  },
  endcaps: {
    opening: {
      enabled: true,
      duration: 3.0,
      title: null,
      subtitle: '全{n}クリップ',
      font: null,
      // 完成済み動画を指定するとその動画をそのまま OP に使う（テロップ/SE/duration は無視、音声は動画のもの）。
      video: null,
    },
    ending: {
      enabled: true,
      duration: 4.0,
      text: 'ご視聴ありがとうございました',
      listClips: false,
      font: null,
      // 完成済み動画を指定するとその動画をそのまま ED に使う（テロップ/SE/duration は無視、音声は動画のもの）。
      video: null,
    },
  },
  // YouTube 公開用メタデータの生成。概要欄テンプレートの可変部をここに置く。
  summary: {
    enabled: true,
    intro: null,
    notice: null,
    siteUrl: null,
    officialChannelUrl: null,
    footer: [],
    titleCandidates: [],
    tags: [],
    maxChars: 5000,
    chapters: {
      enabled: true,
      minSec: 10,
      labels: {},
    },
  },
  qc: {
    enabled: false,
    manifest: true,
    python: 'python3',
    signature: {
      pixFmt: 'yuv420p',
      sampleRate: 44100,
      channels: 2,
    },
    thresholds: {
      durationFrames: 1,
      driftMs: 50,
      // 音声ストリーム尺 − 映像ストリーム尺。連結の累積音ズレがここに合計として出る。
      avGapMs: 50,
      // 音声パケットの pts の穴の合計。ソース由来の穴が残ると穴以降の音声が遅れる。
      audioHoleMs: 10,
      phashDistance: 12,
      // 取り込み側が ffmpeg-normalize（EBU R128 / -23 LUFS）で揃えるため、目標は -23 LUFS ±2 とする。
      integratedLufsMin: -25,
      integratedLufsMax: -21,
      truePeakMax: -1,
      segmentLufsRange: 3,
      // 文字矩形の幅は charWidth ベースの推定で実測より広めに出るため、端が触れただけでは衝突とみなさない。
      collisionAreaRatio: 0.2,
      silenceMinDuration: 0.8,
      blackMinDuration: 0.5,
      freezeMinDuration: 0.5,
      telopFillRatio: 0.3,
      telopColorDistance: 60,
      // これ未満の opacity のボックスは色一致率で判定できないので焼き込み判定をスキップする。
      telopMinOpacity: 0.9,
      chapterDriftSec: 1,
      minSyncCorrelation: 0.15,
    },
    static: {
      maxSerifLines: 4,
    },
    // コンタクトシート（代表フレームの一覧 PNG）。--contact / --review で使う。
    contact: {
      cellWidth: 480,
      columns: 4,
      fontFile: null,
    },
    // コンタクトシートを claude CLI に読ませる目視レビュー。非決定的なので合否には反映しない。
    review: {
      claudeBin: 'claude',
      timeoutMs: 300000,
    },
  },
  effects: {
    zoom: {
      enabled: false,
      mode: 'punch',
      scale: 1.3,
      lead: 0.15,
      minDuration: 2.0,
      minStart: 0.3,
      minZoomDuration: 0.8,
      focus: {
        mode: 'face',
        x: 0.5,
        y: 0.5,
        python: 'python3',
        cascade: null,
        frames: 3,
      },
      analysis: {
        window: 0.1,
        smooth: 3,
        minProminence: 3.0,
        silenceFloor: -60.0,
      },
    },
    // アニメ向け線補正（Anime4K GLSL を ffmpeg libplacebo で適用）。1080p cache の YouTube 圧縮ボケを整え、
    // zoom の 1.3 倍拡大を CNN アップスケールにする。既定 OFF。CLI の --enhance / --no-enhance。
    enhance: {
      enabled: false,
      backend: 'anime4k',
      shadersDir: null,
      restore: 'Restore_CNN_M',
      upscale: 'Upscale_CNN_x2_M',
      clampHighlights: true,
      minSourceHeight: 720,
      required: false,
    },
  },
};

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    if (!token.startsWith('--')) continue;
    token = token.slice(2);

    if (token.startsWith('no-')) {
      appendOpt(opts, token.slice(3), false);
      continue;
    }

    const eq = token.indexOf('=');
    if (eq >= 0) {
      appendOpt(opts, token.slice(0, eq), token.slice(eq + 1));
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      appendOpt(opts, token, next);
      i++;
    } else {
      appendOpt(opts, token, true);
    }
  }
  return opts;
}

function appendOpt(opts, key, value) {
  if (opts[key] === undefined) {
    opts[key] = value;
  } else if (Array.isArray(opts[key])) {
    opts[key].push(value);
  } else {
    opts[key] = [opts[key], value];
  }
}

export function npmConfig(key) {
  const lower = key.toLowerCase().replaceAll('-', '_');
  for (const [envKey, value] of Object.entries(process.env)) {
    if (envKey.toLowerCase() === `npm_config_${lower}`) return value;
  }
  return undefined;
}

function optValue(opts, key) {
  if (opts[key] !== undefined) return opts[key];
  return npmConfig(key);
}

function optBool(opts, key) {
  const v = optValue(opts, key);
  if (v === undefined) return undefined;
  if (v === false || v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}

function optString(opts, key) {
  const v = optValue(opts, key);
  if (v === undefined || v === true || v === false) return undefined;
  return String(Array.isArray(v) ? v.at(-1) : v);
}

function splitList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? structuredClone(base) : structuredClone(override);
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? structuredClone(base) : structuredClone(override);
  }
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? deepMerge(out[key], value) : structuredClone(value);
  }
  return out;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

export function resolveProjectPath(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
}

export function rgbToAssBgr(value, alpha = '00') {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(`色は RGB 6 桁 hex で指定してください: ${value}`);
  }
  const rr = raw.slice(0, 2).toUpperCase();
  const gg = raw.slice(2, 4).toUpperCase();
  const bb = raw.slice(4, 6).toUpperCase();
  const aa = String(alpha).replace(/^#/, '').padStart(2, '0').slice(0, 2).toUpperCase();
  return `&H${aa}${bb}${gg}${rr}`;
}

export function assOverrideColor(value, alpha = '00') {
  return `${rgbToAssBgr(value, alpha)}&`;
}

export function loadConfig(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const explicitConfig = optString(opts, 'config');
  const defaultConfigPath = path.join(moduleDir, 'config.json');
  const configPath = explicitConfig ? path.resolve(projectRoot, explicitConfig) : defaultConfigPath;

  let config = structuredClone(DEFAULTS);
  if (fs.existsSync(configPath)) {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = deepMerge(config, fileConfig);
  } else if (explicitConfig) {
    throw new Error(`設定ファイルが見つかりません: ${configPath}`);
  }

  config = deepMerge(config, cliConfig(opts));
  config.__meta = {
    configPath: fs.existsSync(configPath) ? configPath : null,
    cli: opts,
  };
  validateConfig(config);
  return config;
}

function cliConfig(opts) {
  const out = {};

  const videoId = optString(opts, 'videoId');
  if (videoId) {
    out.select = { ...(out.select || {}), videoId };
    if (!optString(opts, 'mode')) out.select.mode = 'videoId';
  }

  const categoryOpt = optValue(opts, 'category');
  if (categoryOpt !== undefined) {
    out.select = { ...(out.select || {}), categories: splitList(categoryOpt) };
    if (!optString(opts, 'mode')) out.select.mode = 'category';
  }

  const filesOpt = optValue(opts, 'files');
  if (filesOpt !== undefined) {
    out.select = { ...(out.select || {}), files: splitList(filesOpt) };
    if (!optString(opts, 'mode')) out.select.mode = 'files';
  }

  const excludeOpt = optValue(opts, 'exclude');
  if (excludeOpt !== undefined) {
    out.select = { ...(out.select || {}), exclude: splitList(excludeOpt) };
  }

  for (const key of ['mode', 'order']) {
    const v = optString(opts, key);
    if (v) out.select = { ...(out.select || {}), [key]: v };
  }

  const limit = optString(opts, 'limit');
  if (limit) out.select = { ...(out.select || {}), limit: Number(limit) };

  const source = optString(opts, 'source');
  if (source) out.source = source;

  const normalize = optBool(opts, 'normalize');
  if (normalize !== undefined) out.normalizeCache = normalize;

  const resolution = optString(opts, 'resolution');
  if (resolution) out.output = { ...(out.output || {}), resolution };

  const outPath = optString(opts, 'out');
  if (outPath) out.output = { ...(out.output || {}), name: outPath };

  const font = optString(opts, 'font');
  if (font) out.font = font;

  const title = optString(opts, 'title');
  if (title) out.titleOverride = title.replace(/\\n/g, '\n');

  const cards = optBool(opts, 'cards');
  if (cards === false) {
    out.cards = { enabled: false };
    out.endcaps = { opening: { enabled: false }, ending: { enabled: false } };
  } else if (cards === true) {
    out.cards = { enabled: true };
  }

  const bgm = optBool(opts, 'bgm');
  if (bgm !== undefined) out.bgm = { enabled: bgm };

  // --zoom / --enhance はどちらも out.effects へ merge する（後勝ちで潰さない）。
  const zoom = optBool(opts, 'zoom');
  if (zoom !== undefined) {
    out.effects = { ...(out.effects || {}), zoom: { enabled: zoom } };
  }

  const enhance = optBool(opts, 'enhance');
  if (enhance !== undefined) {
    out.effects = { ...(out.effects || {}), enhance: { enabled: enhance } };
  }

  const qc = optBool(opts, 'qc');
  if (qc !== undefined) {
    out.qc = { enabled: qc };
  }

  for (const [flag, key] of [
    ['title', 'title'],
    ['date', 'date'],
    ['serif', 'serif'],
    ['time', 'time'],
    ['progress', 'progress'],
  ]) {
    const enabled = optBool(opts, flag);
    if (enabled !== undefined) {
      out.telops = { ...(out.telops || {}), [key]: { enabled } };
    }
  }

  const opening = optBool(opts, 'opening');
  if (opening !== undefined) {
    out.endcaps = { ...(out.endcaps || {}), opening: { enabled: opening } };
  }
  const ending = optBool(opts, 'ending');
  if (ending !== undefined) {
    out.endcaps = { ...(out.endcaps || {}), ending: { enabled: ending } };
  }

  // --avoid-face / --no-avoid-face はセリフの顔回避のグローバル切り替え。
  // --no-serif などの telops フラグと同じ out.telops へ merge する（後勝ちで潰さない）。
  const avoidFace = optBool(opts, 'avoid-face');
  if (avoidFace !== undefined) {
    out.telops = {
      ...(out.telops || {}),
      serif: { ...(out.telops?.serif || {}), avoidFace: { enabled: avoidFace } },
    };
  }

  return out;
}

function validateConfig(config) {
  const errors = [];
  const selectModes = new Set(['videoId', 'category', 'files']);
  const orders = new Set(['date', 'date-desc', 'stream', 'shuffle', 'as-listed']);
  const sources = new Set(['existing', 'cache']);
  const backgroundTypes = new Set(['video', 'image', 'solid', 'gradient']);

  if (!selectModes.has(config.select.mode)) errors.push(`select.mode が不正です: ${config.select.mode}`);
  if (!orders.has(config.select.order)) errors.push(`select.order が不正です: ${config.select.order}`);
  if (!sources.has(config.source)) errors.push(`source が不正です: ${config.source}`);
  if (!backgroundTypes.has(config.cards.background.type)) {
    errors.push(`cards.background.type が不正です: ${config.cards.background.type}`);
  }
  if (!/^\d+x\d+$/.test(String(config.output.resolution))) {
    errors.push(`output.resolution は WxH 形式で指定してください: ${config.output.resolution}`);
  }
  if (!Number.isFinite(Number(config.output.fps)) || Number(config.output.fps) <= 0) {
    errors.push(`output.fps が不正です: ${config.output.fps}`);
  }
  if (config.select.mode === 'videoId' && !config.select.videoId) {
    errors.push('select.mode=videoId では --videoId または select.videoId が必要です。');
  }
  if (config.select.mode === 'category' && config.select.categories.length === 0) {
    errors.push('select.mode=category では --category または select.categories が必要です。');
  }
  if (config.select.mode === 'files' && config.select.files.length === 0) {
    errors.push('select.mode=files では --files または select.files が必要です。');
  }
  if (!Array.isArray(config.select.exclude)) {
    errors.push('select.exclude は配列で指定してください。');
  }

  validateAligns(config, errors);
  validateColors(config, errors);
  validateTitleOverrides(config, errors);
  validateEffects(config, errors);
  validateEnhance(config, errors);
  validateQc(config, errors);

  if (errors.length > 0) {
    throw new Error(errors.map((line) => `- ${line}`).join('\n'));
  }
}

function validateQc(config, errors) {
  const qc = config.qc || {};
  if (!Number.isFinite(Number(qc.signature?.sampleRate)) || Number(qc.signature?.sampleRate) <= 0) {
    errors.push(`qc.signature.sampleRate が不正です: ${qc.signature?.sampleRate}`);
  }
  if (!Number.isFinite(Number(qc.signature?.channels)) || Number(qc.signature?.channels) <= 0) {
    errors.push(`qc.signature.channels が不正です: ${qc.signature?.channels}`);
  }
  for (const [key, value] of Object.entries(qc.thresholds || {})) {
    if (!Number.isFinite(Number(value))) {
      errors.push(`qc.thresholds.${key} が不正です: ${value}`);
    }
  }
  if (!Number.isFinite(Number(qc.static?.maxSerifLines)) || Number(qc.static?.maxSerifLines) < 1) {
    errors.push(`qc.static.maxSerifLines は 1 以上で指定してください: ${qc.static?.maxSerifLines}`);
  }
}

function validateEffects(config, errors) {
  const zoomModes = new Set(['punch', 'full']);
  const focusModes = new Set(['face', 'fixed', 'center']);
  const zoom = config.effects?.zoom;
  if (!zoom) {
    return;
  }
  if (!zoomModes.has(zoom.mode)) {
    errors.push(`effects.zoom.mode が不正です: ${zoom.mode}`);
  }
  if (!Number.isFinite(Number(zoom.scale)) || Number(zoom.scale) <= 1 || Number(zoom.scale) > 3) {
    errors.push(`effects.zoom.scale は 1 より大きく 3 以下で指定してください: ${zoom.scale}`);
  }
  if (!Number.isFinite(Number(zoom.lead)) || Number(zoom.lead) < 0) {
    errors.push(`effects.zoom.lead は 0 以上で指定してください: ${zoom.lead}`);
  }
  if (!Number.isFinite(Number(zoom.minDuration)) || Number(zoom.minDuration) < 0) {
    errors.push(`effects.zoom.minDuration は 0 以上で指定してください: ${zoom.minDuration}`);
  }
  if (!Number.isFinite(Number(zoom.minStart)) || Number(zoom.minStart) < 0) {
    errors.push(`effects.zoom.minStart は 0 以上で指定してください: ${zoom.minStart}`);
  }
  if (!Number.isFinite(Number(zoom.minZoomDuration)) || Number(zoom.minZoomDuration) < 0) {
    errors.push(`effects.zoom.minZoomDuration は 0 以上で指定してください: ${zoom.minZoomDuration}`);
  }
  if (!focusModes.has(zoom.focus?.mode)) {
    errors.push(`effects.zoom.focus.mode が不正です: ${zoom.focus?.mode}`);
  }
  for (const axis of ['x', 'y']) {
    const value = Number(zoom.focus?.[axis]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`effects.zoom.focus.${axis} は 0〜1 で指定してください: ${zoom.focus?.[axis]}`);
    }
  }
  if (!Number.isFinite(Number(zoom.focus?.frames)) || Number(zoom.focus?.frames) < 1) {
    errors.push(`effects.zoom.focus.frames は 1 以上で指定してください: ${zoom.focus?.frames}`);
  }
  if (!Number.isFinite(Number(zoom.analysis?.window)) || Number(zoom.analysis?.window) <= 0) {
    errors.push(`effects.zoom.analysis.window は 0 より大きい値で指定してください: ${zoom.analysis?.window}`);
  }
}

function validateEnhance(config, errors) {
  const enhance = config.effects?.enhance;
  if (!enhance) {
    return;
  }
  if (enhance.backend !== 'anime4k') {
    errors.push(`effects.enhance.backend が不正です: ${enhance.backend}`);
  }
  for (const key of ['restore', 'upscale']) {
    const value = enhance[key];
    if (value !== null && value !== undefined && !/^[A-Za-z0-9_.]+$/.test(String(value))) {
      errors.push(`effects.enhance.${key} はシェーダ名（例 Restore_CNN_M）または null で指定してください: ${value}`);
    }
  }
  if (!Number.isInteger(Number(enhance.minSourceHeight)) || Number(enhance.minSourceHeight) < 1) {
    errors.push(`effects.enhance.minSourceHeight は 1 以上の整数で指定してください: ${enhance.minSourceHeight}`);
  }
  if (enhance.shadersDir !== null && enhance.shadersDir !== undefined && typeof enhance.shadersDir !== 'string') {
    errors.push('effects.enhance.shadersDir は文字列または null で指定してください。');
  }
  for (const key of ['enabled', 'clampHighlights', 'required']) {
    if (typeof enhance[key] !== 'boolean') {
      errors.push(`effects.enhance.${key} は true / false で指定してください: ${enhance[key]}`);
    }
  }
}

function validateAligns(config, errors) {
  const checks = [
    ['telops.title.align', config.telops.title.align],
    ['telops.date.align', config.telops.date.align],
    ['telops.time.align', config.telops.time.align],
    ['telops.serif.align', config.telops.serif.align],
    ['telops.progress.align', config.telops.progress.align],
    ['cards.index.align', config.cards.index.align],
  ];
  for (const [name, value] of checks) {
    if (!ALIGN[value]) errors.push(`${name} が不正です: ${value}`);
  }
}

function validateColors(config, errors) {
  const candidates = [
    config.telops.title.color,
    config.telops.title.box?.fill,
    config.telops.date.color,
    config.telops.time.color,
    config.telops.serif.color,
    config.telops.serif.box?.fill,
    config.telops.serif.box?.border,
    config.telops.progress.color,
    config.cards.background.color,
    config.cards.background.gradient?.c0,
    config.cards.background.gradient?.c1,
    config.cards.index.color,
  ].filter(Boolean);
  for (const color of candidates) {
    try {
      rgbToAssBgr(color);
    } catch (err) {
      errors.push(err.message);
    }
  }
}

function validateTitleOverrides(config, errors) {
  const overrides = config.telops.title.overrides;
  if (!isPlainObject(overrides)) {
    errors.push('telops.title.overrides は videoId をキーにしたオブジェクトで指定してください。');
    return;
  }
  for (const [videoId, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') {
      errors.push(`telops.title.overrides.${videoId} は文字列で指定してください。`);
    }
  }
}

export function outputSize(config) {
  const [width, height] = String(config.output.resolution).split('x').map((n) => Number(n));
  return { width, height, fps: Number(config.output.fps) };
}
