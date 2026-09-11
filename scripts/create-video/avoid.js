import { makeTextElement, textBoxRect } from './ass.js';
import { detectFaceRects, transformRectThroughZoom } from './effects.js';

// セリフボックスが演者の顔と重なるクリップだけ、顔の無い側へ寄せて幅を狭める。
//
// 既定プリセットのセリフボックスは固定幅（画面幅 − 左右マージン）で、右側に立つ演者の口〜あごを
// 隠していた（実測: 顔 y 628-993 に対しボックス上端 y 891）。ボックスは画面下端に張り付いており
// 下へ逃がす余地が無いので、顔の左右どちらか広い側にボックスを収める。
export async function planSerifAvoidance({ tools, clip, sourceMp4, config, size, workDir, zoom }) {
  const style = config.telops?.serif;
  const setting = style?.avoidFace || {};
  const override = clip.data?.effects?.avoidFace;
  const killSwitch = config.__meta?.cli?.['avoid-face'] === false;

  if (!style?.enabled || !style.box?.enabled) {
    return null;
  }
  if (killSwitch) {
    return override !== undefined ? { applied: false, reason: '--no-avoid-face 指定' } : null;
  }
  if (override === false) {
    return { applied: false, reason: '手動OFF' };
  }
  if (!setting.enabled && override === undefined) {
    return null;
  }
  if (!String(clip.data?.serif || '').trim()) {
    return null;
  }

  const duration = Math.max(0.2, Number(clip.duration) || (Number(clip.endTime) - Number(clip.startTime)) || 0.2);
  const count = Math.max(1, Math.round(Number(setting.frames) || 3));
  // クリップ全体に散らして抜く。演者が動いても拾えるように、検出した矩形は全部まとめて避ける。
  const times = Array.from({ length: count }, (_, i) => duration * ((i + 0.5) / count));
  const focus = { ...(config.effects?.zoom?.focus || {}) };
  const detected = await detectFaceRects({ tools, focus, sourceMp4, size, workDir, times });
  if (detected.length === 0) {
    return { applied: false, reason: '顔未検出' };
  }

  const face = unionRects(facesInOutputSpace({ detected, times, zoom, size }));
  const box = defaultSerifBox({ clip, style, size });
  if (!intersects(face, box)) {
    return { applied: false, reason: '重ならない', face };
  }

  const manualSide = typeof override === 'object' && override !== null ? override.side : undefined;
  const plan = chooseAvoidance({
    face,
    width: size.width,
    marginH: box.marginH,
    gap: Math.round(size.width * (Number(setting.gap) || 0.0125)),
    minWidth: Math.round(size.width * (Number(setting.minWidth) || 0.45)),
    side: manualSide,
  });
  return { ...plan, face };
}

// 顔の左右どちらにボックスを収めるかを決める純関数。テストはこれに対して書く。
export function chooseAvoidance({ face, width, marginH, gap, minWidth, side }) {
  const leftWidth = face.x - gap - marginH;
  const rightWidth = width - (face.x + face.w) - gap - marginH;
  const preferred = side === 'left' || side === 'right'
    ? side
    : (leftWidth >= rightWidth ? 'left' : 'right');
  const available = preferred === 'left' ? leftWidth : rightWidth;

  if (available < minWidth) {
    return {
      applied: false,
      fallback: true,
      reason: `幅不足: ${Math.max(0, Math.round(available))}px < ${minWidth}px`,
      side: preferred,
    };
  }
  if (preferred === 'left') {
    return { applied: true, side: 'left', marginL: marginH, marginR: width - (face.x - gap) };
  }
  return { applied: true, side: 'right', marginL: face.x + face.w + gap, marginR: marginH };
}

// 顔矩形を出力座標へ揃える。punch ズームは開始前後で画面が変わるので、両方の座標で避ける。
function facesInOutputSpace({ detected, times, zoom, size }) {
  const rects = [];
  const zoomed = zoom && !zoom.skip && zoom.focus;
  for (const [i, rect] of detected.entries()) {
    const at = times[Math.min(i, times.length - 1)];
    const afterZoom = zoomed && at >= Number(zoom.at || 0);
    if (!zoomed || !afterZoom || zoom.mode !== 'full') {
      rects.push(rect);
    }
    if (zoomed && (afterZoom || zoom.mode === 'full')) {
      const moved = transformRectThroughZoom(rect, { zoom, size });
      if (moved) {
        rects.push(moved);
      }
    }
  }
  return rects;
}

// 避ける前のセリフボックス。makeTextElement → textBoxRect と同じ経路で作る。
function defaultSerifBox({ clip, style, size }) {
  const element = makeTextElement({
    name: 'serif',
    text: clip.data.serif,
    style,
    width: size.width,
    height: size.height,
    duration: 1,
  });
  const rect = textBoxRect(element, size.width, size.height);
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, marginH: element.marginH };
}

function unionRects(rects) {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function formatAvoidLog(plan) {
  if (!plan) {
    return null;
  }
  if (plan.applied) {
    return `   🙂 顔回避: ${plan.side === 'left' ? '左' : '右'}へ寄せ（顔 x${plan.face.x}-${plan.face.x + plan.face.w} / ボックス幅 ${plan.marginL}〜${plan.marginR} を除く）`;
  }
  if (plan.fallback) {
    return `   🙂 顔回避: 見送り (${plan.reason}) — 全幅のまま`;
  }
  return null;
}
