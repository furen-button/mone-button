import { detectFaceRects } from './effects.js';
import { probeDuration, probeVideoStream } from './ffmpeg.js';
import { restoreFilter, upscaleFilter } from './enhance.js';

// 元映像の座標系で検出する。個別 x/y は手動位置、全体 x/y は検出失敗時の予備位置。
export async function planReframe({ tools, clip, sourceMp4, config, size, workDir, probe = null, detect = detectFaceRects }) {
  const setting = config.effects?.reframe || {};
  const override = clip.data?.effects?.reframe;
  if (override === false || (!setting.enabled && override === undefined)) {
    return null;
  }
  const manual = override && typeof override === 'object' ? override : {};
  const source = probe || probeVideoStream(tools.ffprobe, sourceMp4);
  let focus = point(manual);
  let faceHeight = null;
  let fallback = false;
  if (focus) {
    focus.source = 'manual';
  } else {
    const duration = Number(source.duration) || probeDuration(tools.ffprobe, sourceMp4);
    const count = Math.max(1, Math.round(Number(setting.frames) || 3));
    const times = Array.from({ length: count }, (_, i) => duration * ((i + 0.5) / count));
    const frames = await detect({ tools, focus: setting, sourceMp4, size: source, workDir, times, sourceCoordinates: true, allFaces: true });
    const faces = frames.map((frame) => pickFace(Array.isArray(frame) ? frame : [frame], setting.pick || 'largest')).filter(Boolean);
    focus = faceFocus(faces, source);
    if (focus) {
      faceHeight = median(faces.map((rect) => rect.h / source.height));
    } else {
      fallback = true;
      const fixed = point(setting);
      focus = { ...(fixed || { x: 0.5, y: 0.5 }), source: fixed ? 'config' : 'center' };
    }
  }
  const layout = planReframeLayout({ source, size, focus, faceHeight, setting: { ...setting, zoom: manual.zoom ?? setting.zoom } });
  return {
    applied: true,
    ...layout,
    focus,
    faceHeight,
    pick: setting.pick || 'largest',
    from: { width: source.width, height: source.height },
    fallback,
  };
}

// 小さい顔アイコンを避け、最大顔の半分以上の高さがある候補から一番右を選ぶ。
export function pickFace(faces, pick = 'largest') {
  if (faces.length === 0) {
    return null;
  }
  const largest = [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (pick === 'right') {
    const minHeight = largest.h * 0.5;
    return faces.filter((rect) => rect.h >= minHeight)
      .sort((a, b) => (b.x + b.w / 2) - (a.x + a.w / 2) || b.w * b.h - a.w * a.h)[0];
  }
  return largest;
}

export function faceFocus(faces, source) {
  if (faces.length === 0) {
    return null;
  }
  return {
    x: median(faces.map((rect) => (rect.x + rect.w / 2) / source.width)),
    y: median(faces.map((rect) => (rect.y + rect.h / 2) / source.height)),
    source: 'face',
  };
}

// 枠を元映像内に収められる倍率と、顔の最低サイズを満たす倍率を求める。
// 上限に当たったら横だけクランプし、縦の不足は fill で補って顔の高さを守る。
export function planReframeLayout({ source, size, focus, faceHeight = null, setting = {} }) {
  const target = setting.target || { x: 0.5, y: 0.45 };
  const baseHeight = Math.min(source.height, source.width * size.height / size.width);
  const baseWidth = baseHeight * size.width / size.height;
  const minZoom = Math.max(1, Number(setting.zoom) || 1);
  const centerZoom = Math.max(
    neededZoom(target.x * baseWidth, focus.x * source.width),
    neededZoom((1 - target.x) * baseWidth, (1 - focus.x) * source.width),
    neededZoom(target.y * baseHeight, focus.y * source.height),
    neededZoom((1 - target.y) * baseHeight, (1 - focus.y) * source.height),
  );
  const faceZoom = faceHeight > 0 ? (Number(setting.minFaceHeight) || 0) * baseHeight / (faceHeight * source.height) : 0;
  const requested = Math.max(minZoom, centerZoom, faceZoom);
  const maxZoom = Number(setting.maxZoom) || 3;
  const zoom = Math.max(1, Math.min(maxZoom, requested));
  const reason = requested > maxZoom ? 'cap' : (requested === minZoom ? 'min' : (requested === faceZoom ? 'face size' : 'center'));
  const w = Math.min(even(baseWidth / zoom), Math.floor(source.width / 2) * 2);
  const h = Math.min(even(baseHeight / zoom), Math.floor(source.height / 2) * 2);
  const frame = {
    x: Math.floor(Math.max(0, Math.min(source.width - w, focus.x * source.width - target.x * w)) / 2) * 2,
    y: Math.min(evenFloor(source.height) - 2, evenFloor(focus.y * source.height - target.y * h)),
    w,
    h,
  };
  const y = Math.max(0, frame.y);
  const crop = { x: frame.x, y, w, h: Math.min(evenFloor(source.height), frame.y + h) - y };
  const top = Math.max(0, evenFloor((crop.y - frame.y) * size.height / h));
  const bottom = Math.max(0, evenFloor((frame.y + h - crop.y - crop.h) * size.height / h));
  return {
    frame,
    crop,
    target,
    zoom,
    zoomReason: reason,
    zoomNeeded: { min: minZoom, center: Number.isFinite(centerZoom) ? centerZoom : null, faceSize: faceZoom },
    fill: crop.h < h ? (setting.fill || 'blur') : null,
    foreground: { x: 0, y: top, w: size.width, h: size.height - top - bottom },
  };
}

// 本番・still（先頭 trim 付きの -vf）・QC が共有する入出力1本のフィルタ列。
// ラベルはこの列の内部だけで閉じる。前景だけ復元・CNN拡大し、ぼかし背景は軽い縮小画像で作る。
export function reframeFilters(plan, size, { enhance = null } = {}) {
  const foreground = plan.foreground || { x: 0, y: 0, w: size.width, h: size.height };
  const scaledSize = { width: foreground.w, height: foreground.h };
  const subject = [
    reframeCropFilter(plan),
    'setsar=1',
    ...(size.fps ? [`fps=${size.fps}`] : []),
    ...(enhance?.applied && enhance.restorePreset ? [restoreFilter(enhance)] : []),
    enhance?.applied && enhance.upscalePreset ? upscaleFilter(enhance, scaledSize) : `scale=${foreground.w}:${foreground.h}:flags=lanczos`,
    'setsar=1',
  ].join(',');
  if (!plan.fill) {
    return subject;
  }
  if (plan.fill === 'black') {
    return `${subject},pad=${size.width}:${size.height}:${foreground.x}:${foreground.y}:color=black`;
  }
  const smallWidth = even(size.width / 4);
  const smallHeight = even(size.height / 4);
  return [
    'split=2[rfbg][rffg]',
    `[rfbg]${size.fps ? `fps=${size.fps},` : ''}scale=${smallWidth}:${smallHeight}:force_original_aspect_ratio=increase,crop=${smallWidth}:${smallHeight},setsar=1,boxblur=8:1,eq=brightness=-0.06,scale=${size.width}:${size.height}[rfbase]`,
    `[rffg]${subject}[rfsubject]`,
    `[rfbase][rfsubject]overlay=x=${foreground.x}:y=${foreground.y}:shortest=1:format=auto,format=yuv420p,setsar=1`,
  ].join(';');
}

// 旧 manifest と既存の矩形利用側にも使える単純な切り出し。
export function reframeCropFilter(plan) {
  const { x, y, w, h } = plan.crop;
  return `crop=${w}:${h}:${x}:${y}`;
}

export function reframeCropRect({ source, size, focus, zoom = 1 }) {
  const h = Math.min(source.height, source.width * size.height / size.width) / Math.max(1, zoom);
  const w = Math.min(even(h * size.width / size.height), Math.floor(source.width / 2) * 2);
  const height = Math.min(even(h), Math.floor(source.height / 2) * 2);
  return {
    x: evenFloor(Math.max(0, Math.min(source.width - w, focus.x * source.width - w / 2))),
    y: evenFloor(Math.max(0, Math.min(source.height - height, focus.y * source.height - height / 2))),
    w,
    h: height,
  };
}

function neededZoom(distance, available) {
  if (distance === 0) {
    return 0;
  }
  return available > 0 ? distance / available : Infinity;
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function evenFloor(value) {
  return Math.floor(value / 2) * 2;
}

function point(value) {
  if (value?.x == null || value?.y == null) {
    return null;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
