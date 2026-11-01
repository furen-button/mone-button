// Node とブラウザで共有するサムネイル形式。任意の URL やファイルパスは受けない。
export const THUMBNAIL_SIZE = { width: 1280, height: 720 };
export const FONT_WEIGHTS = {
  'Dela Gothic One': [400],
  'Mochiy Pop One': [400],
  'M PLUS Rounded 1c': [100, 300, 400, 500, 700, 800, 900],
  'RocknRoll One': [400],
  'Reggae One': [400],
  'Rampart One': [400],
  'Potta One': [400],
  'Zen Maru Gothic': [300, 400, 500, 700, 900],
  'Noto Sans JP': Array.from({ length: 9 }, (_, i) => (i + 1) * 100),
  'Kaisei Decol': [400, 500, 700],
};

export function parseAssetRef(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(frame|image|face):(.+)$/u.exec(value);
  if (!match) {
    return null;
  }
  const [, type, id] = match;
  const valid =
    type === 'face'
      ? /^[a-z0-9-]+\/[\w-]+\.png$/u.test(id)
      : type === 'frame'
        ? /^[0-9a-f]{40}$/u.test(id)
        : /^[0-9a-f]{32}$/u.test(id);
  return valid ? { type, id } : null;
}

function fail(message) {
  throw new Error(message);
}
function object(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    fail('オブジェクトが必要です。');
  }
  return v;
}
function number(v, fallback, min, max) {
  if (v === undefined) {
    return fallback;
  }
  if (!Number.isFinite(v) || v < min || v > max) {
    fail(`数値は ${min}〜${max} で指定してください。`);
  }
  return v;
}
function string(v, fallback = '', max = 2000) {
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== 'string' || v.length > max) {
    fail('文字列が不正です。');
  }
  return v;
}
function color(v, fallback) {
  const result = string(v, fallback, 9);
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(result)) {
    fail('色は #RRGGBB または #RRGGBBAA です。');
  }
  return result;
}
function choice(v, fallback, values) {
  if (v === undefined) {
    return fallback;
  }
  if (!values.includes(v)) {
    fail('選択値が不正です。');
  }
  return v;
}
function boolean(v, fallback) {
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== 'boolean') {
    fail('真偽値が必要です。');
  }
  return v;
}
function outline(v) {
  object(v);
  return { width: number(v.width, 0, 0, 100), color: color(v.color, '#FFFFFF') };
}
export function normalizeRecipe(value) {
  const v = object(value);
  if (typeof v.source !== 'string' || !/^cache:[\w-]+$/u.test(v.source)) {
    fail('高画質キャッシュを指定してください。');
  }
  return {
    source: v.source,
    at: number(v.at, 0, 0, 86400),
    upscale: choice(v.upscale, 'anime4k', ['none', 'anime4k']),
  };
}

export function normalizeProject(value, { template = false } = {}) {
  const v = object(value);
  if (
    v.version !== 1 ||
    v.size?.width !== 1280 ||
    v.size?.height !== 720 ||
    !Array.isArray(v.layers) ||
    v.layers.length > 80
  ) {
    fail('version:1 / 1280×720 / 最大80レイヤーで指定してください。');
  }
  const ids = new Set();
  const layers = v.layers.map((raw) => {
    const l = object(raw);
    const id = string(l.id, '', 80);
    if (!/^[\w-]+$/u.test(id) || ids.has(id)) {
      fail('レイヤー ID が不正または重複しています。');
    }
    ids.add(id);
    const type = choice(l.type, null, ['image', 'text', 'rect']);
    if (!type) {
      fail('レイヤー種別が必要です。');
    }
    const out = {
      id,
      type,
      x: number(l.x, 640, -10000, 10000),
      y: number(l.y, 360, -10000, 10000),
      rotation: number(l.rotation, 0, -3600, 3600),
      opacity: number(l.opacity, 1, 0, 1),
      hidden: boolean(l.hidden, false),
      locked: boolean(l.locked, false),
    };
    if (l.slot !== undefined) {
      out.slot = choice(
        l.slot,
        null,
        type === 'image' ? ['frame', 'face'] : type === 'text' ? ['title', 'subtitle'] : [],
      );
    }
    if (type === 'image') {
      if (l.src !== undefined) {
        const ref = parseAssetRef(l.src);
        if (!ref || (template && (ref.type !== 'face' || l.slot))) {
          fail('素材の参照が不正です。テンプレートの slot は src を持てません。');
        }
        out.src = l.src;
      }
      if (l.recipe !== undefined) {
        if (template || (l.src && parseAssetRef(l.src)?.type !== 'frame')) {
          fail('recipe はプロジェクトの frame 素材にだけ保存できます。');
        }
        out.recipe = normalizeRecipe(l.recipe);
      }
      out.scale = number(l.scale, 1, 0.01, 20);
      out.fit = choice(l.fit, 'free', ['free', 'cover']);
      out.flipX = boolean(l.flipX, false);
      if (l.outline !== undefined) {
        out.outline = outline(l.outline);
      }
      if (l.shadow !== undefined) {
        const s = object(l.shadow);
        out.shadow = {
          blur: number(s.blur, 0, 0, 100),
          x: number(s.x, 0, -100, 100),
          y: number(s.y, 0, -100, 100),
          color: color(s.color, '#00000080'),
        };
      }
      const f = l.filter === undefined ? {} : object(l.filter);
      out.filter = { blur: number(f.blur, 0, 0, 100), brightness: number(f.brightness, 1, 0, 3) };
    } else if (type === 'text') {
      out.text = string(l.text, 'タイトル');
      out.font = choice(l.font, 'Dela Gothic One', Object.keys(FONT_WEIGHTS));
      out.weight = choice(l.weight, 400, FONT_WEIGHTS[out.font]);
      out.size = number(l.size, 100, 1, 600);
      out.color = color(l.color, '#FF4FA0');
      out.emphasisColor = color(l.emphasisColor, '#FFD800');
      if (l.outlines !== undefined && (!Array.isArray(l.outlines) || l.outlines.length > 8)) {
        fail('縁取りは最大8層です。');
      }
      out.outlines = (l.outlines || []).map(outline);
      out.lineHeight = number(l.lineHeight, 1.1, 0.5, 3);
      out.letterSpacing = number(l.letterSpacing, 0, -50, 100);
      out.align = choice(l.align, 'left', ['left', 'center', 'right']);
    } else {
      out.w = number(l.w, 300, 1, 10000);
      out.h = number(l.h, 150, 1, 10000);
      out.radius = number(l.radius, 0, 0, 1000);
      if (typeof l.fill === 'string' || l.fill === undefined) {
        out.fill = color(l.fill, '#6B3FA0');
      } else {
        const f = object(l.fill);
        if (f.type !== 'linear') {
          fail('線形グラデーションを指定してください。');
        }
        out.fill = {
          type: 'linear',
          from: color(f.from, '#6B3FA0'),
          to: color(f.to, '#FF4FA0'),
          angle: number(f.angle, 90, -360, 360),
        };
      }
    }
    return out;
  });
  return { version: 1, size: { ...THUMBNAIL_SIZE }, layers };
}

export function applyTemplate(template, slots = {}) {
  const project = normalizeProject(template, { template: true });
  for (const layer of project.layers) {
    const value = slots[layer.slot];
    if (value === undefined) {
      continue;
    }
    if (layer.type === 'text') {
      layer.text = value;
    } else if (layer.type === 'image') {
      if (typeof value === 'string') {
        layer.src = value;
      } else {
        layer.src = value.src;
        layer.recipe = value.recipe;
      }
    }
  }
  return normalizeProject(project);
}
