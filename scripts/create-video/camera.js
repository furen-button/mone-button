// ブラウザとレンダラで共有する元映像座標のカメラ計画。Node 固有の依存は置かない。
export const CAMERA_ASPECTS = ['9:16', '16:9', '1:1'];

export function normalizeCamera(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    return { error: 'キーフレームは 1〜1000 件の配列で指定してください。' };
  }
  const keyframes = [];
  for (const frame of value) {
    if (!frame || typeof frame !== 'object' || !Number.isFinite(frame.t) || frame.t < 0
        || !Number.isFinite(frame.x) || frame.x < 0 || frame.x > 1
        || !Number.isFinite(frame.y) || frame.y < 0 || frame.y > 1
        || !Number.isFinite(frame.zoom) || frame.zoom < 1 || frame.zoom > 4
        || !['smooth', 'linear', 'cut'].includes(frame.ease ?? 'smooth')) {
      return { error: 't は非負、x/y は 0〜1、zoom は 1〜4、ease は smooth / linear / cut で指定してください。' };
    }
    keyframes.push({ t: frame.t, x: frame.x, y: frame.y, zoom: frame.zoom, ease: frame.ease ?? 'smooth' });
  }
  keyframes.sort((a, b) => a.t - b.t);
  if (keyframes.some((frame, i) => i > 0 && frame.t === keyframes[i - 1].t)) {
    return { error: 'キーフレームの時刻は重複できません。' };
  }
  return { keyframes };
}

export function aspectKey(size) {
  return CAMERA_ASPECTS.find((aspect) => {
    const [w, h] = aspect.split(':').map(Number);
    return Math.abs(size.width / size.height - w / h) < 0.0001;
  }) ?? null;
}

export function baseRect(source, aspect) {
  const [w, h] = aspect.split(':').map(Number);
  const height = Math.min(source.height, source.width * h / w);
  return { w: height * w / h, h: height };
}

export function cameraFrameAt(keyframes, t) {
  const first = keyframes[0];
  if (t <= first.t) {
    return { ...first, t };
  }
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t < b.t) {
      const p = (t - a.t) / (b.t - a.t);
      const u = a.ease === 'cut' ? 0 : a.ease === 'linear' ? p : p * p * (3 - 2 * p);
      return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u,
        zoom: Math.exp(Math.log(a.zoom) + Math.log(b.zoom / a.zoom) * u), ease: a.ease ?? 'smooth' };
    }
  }
  return { ...keyframes.at(-1), t };
}

export function cameraRectAt(keyframes, t, source, aspect) {
  const frame = cameraFrameAt(keyframes, t);
  const base = baseRect(source, aspect);
  const w = base.w / frame.zoom;
  const h = base.h / frame.zoom;
  return { x: Math.max(0, Math.min(source.width - w, frame.x * source.width - w / 2)),
    y: Math.max(0, Math.min(source.height - h, frame.y * source.height - h / 2)), w, h };
}

// 数値・変数・関数だけの小さな AST。式の生成と JS 評価を同じ構造から行う。
const op = (name, ...args) => ({ name, args });
export function cameraExprAst(keyframes, source, aspect) {
  function field(key) {
    let tail = keyframes.at(-1)[key];
    for (let i = keyframes.length - 2; i >= 0; i -= 1) {
      const a = keyframes[i];
      const b = keyframes[i + 1];
      const p = op('clip', op('/', op('-', 't', a.t), b.t - a.t), 0, 1);
      const u = a.ease === 'cut' ? 0 : a.ease === 'linear' ? p : op('*', op('*', p, p), op('-', 3, op('*', 2, p)));
      const v = key === 'zoom'
        ? op('exp', op('+', Math.log(a.zoom), op('*', Math.log(b.zoom / a.zoom), u)))
        : op('+', a[key], op('*', b[key] - a[key], u));
      tail = op('if', op('lt', 't', b.t), v, tail);
    }
    return tail;
  }
  const base = baseRect(source, aspect);
  const zoom = field('zoom');
  const w = op('/', base.w, zoom);
  const h = op('/', base.h, zoom);
  return { w, h,
    x: op('clip', op('-', op('*', field('x'), source.width), op('/', w, 2)), 0, op('-', source.width, w)),
    y: op('clip', op('-', op('*', field('y'), source.height), op('/', h, 2)), 0, op('-', source.height, h)) };
}

export function exprToString(expr) {
  if (typeof expr !== 'object') {
    return String(expr);
  }
  const args = expr.args.map(exprToString);
  return ['+', '-', '*', '/'].includes(expr.name) ? `(${args[0]}${expr.name}${args[1]})` : `${expr.name}(${args.join(',')})`;
}

export function evalExpr(expr, t) {
  if (typeof expr === 'number') {
    return expr;
  }
  if (expr === 't') {
    return t;
  }
  const [a, b, c] = expr.args.map((arg) => evalExpr(arg, t));
  switch (expr.name) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case 'exp': return Math.exp(a);
    case 'clip': return Math.max(b, Math.min(c, a));
    case 'lt': return a < b ? 1 : 0;
    case 'if': return a ? b : c;
    default: throw new Error(`未知の式: ${expr.name}`);
  }
}

export function shiftCamera(keyframes, deltaSec, duration) {
  return [cameraFrameAt(keyframes, deltaSec),
    ...keyframes.filter((frame) => frame.t > deltaSec && frame.t < deltaSec + duration),
    cameraFrameAt(keyframes, deltaSec + duration)]
    .map((frame) => ({ ...frame, t: frame.t - deltaSec }));
}
