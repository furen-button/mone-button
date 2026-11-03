import { baseRect, cameraFrameAt, cameraRectAt } from '../../scripts/create-video/camera.js'
import type { CameraAspect, CameraFrame, Ease } from './types'

export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
// キーフレームが無いときの枠。保存はせず、動かしたときに初めてキーフレームになる。
export const DEFAULT_FRAME: CameraFrame = { t: 0, x: 0.5, y: 0.5, zoom: 1, ease: 'smooth' }

// 今の時刻の枠の中心と倍率（キーフレームが無ければ既定値）。
export function frameAt(keyframes: CameraFrame[], t: number): CameraFrame {
  if (keyframes.length === 0) {
    return { ...DEFAULT_FRAME, t }
  }
  return cameraFrameAt(keyframes, t)
}

// 元映像の px での枠。プレビューの描画・ドラッグの当たり判定・本番（camera.js）で同じ式を使う。
export function rectAt(keyframes: CameraFrame[], t: number, source: Size, aspect: CameraAspect): Rect {
  return cameraRectAt(keyframes.length > 0 ? keyframes : [{ ...DEFAULT_FRAME, t }], t, source, aspect)
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

// 枠が元映像からはみ出さない中心に寄せる（本番も描画時に同じだけ寄せるが、保存する値も揃えておく）。
export function clampCenter(frame: { x: number; y: number; zoom: number }, source: Size, aspect: CameraAspect): { x: number; y: number } {
  const base = baseRect(source, aspect)
  const halfW = base.w / frame.zoom / 2 / source.width
  const halfH = base.h / frame.zoom / 2 / source.height
  return {
    x: Math.min(1 - halfW, Math.max(halfW, frame.x)),
    y: Math.min(1 - halfH, Math.max(halfH, frame.y)),
  }
}

// 半フレーム以内にあるキーフレームの番号。無ければ -1。
export function keyframeIndexAt(keyframes: CameraFrame[], t: number, fps: number): number {
  const tolerance = 0.5 / (fps || 30)
  return keyframes.findIndex((frame) => Math.abs(frame.t - t) <= tolerance)
}

// 今の時刻のキーフレームを書き換える。無ければ補間した枠に patch を当てて差し込む。
export function upsertKeyframe(
  keyframes: CameraFrame[],
  t: number,
  patch: Partial<Pick<CameraFrame, 'x' | 'y' | 'zoom' | 'ease'>>,
  fps: number,
): { keyframes: CameraFrame[]; index: number } {
  const index = keyframeIndexAt(keyframes, t, fps)
  if (index >= 0) {
    const next = keyframes.map((frame, i) => (i === index ? { ...frame, ...patch } : frame))
    return { keyframes: next, index }
  }
  const current = frameAt(keyframes, t)
  const inserted: CameraFrame = { t: roundTime(t), x: current.x, y: current.y, zoom: current.zoom, ease: 'smooth', ...patch }
  const next = [...keyframes, inserted].sort((a, b) => a.t - b.t)
  return { keyframes: next, index: next.indexOf(inserted) }
}

// キーフレームの時刻を動かす。前後のキーフレームを追い越さないよう 1 フレーム手前で止める。
export function moveKeyframe(keyframes: CameraFrame[], index: number, t: number, fps: number, duration: number): CameraFrame[] {
  const step = 1 / (fps || 30)
  const min = index > 0 ? keyframes[index - 1].t + step : 0
  const max = index < keyframes.length - 1 ? keyframes[index + 1].t - step : duration
  const clamped = roundTime(Math.min(max, Math.max(min, t)))
  return keyframes.map((frame, i) => (i === index ? { ...frame, t: clamped } : frame))
}

export function setEase(keyframes: CameraFrame[], index: number, ease: Ease): CameraFrame[] {
  return keyframes.map((frame, i) => (i === index ? { ...frame, ease } : frame))
}

export function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000
}

export function sameTrack(a: CameraFrame[] | undefined, b: CameraFrame[] | undefined): boolean {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b))
}

function normalizeForCompare(track: CameraFrame[] | undefined): CameraFrame[] {
  return (track ?? []).map((frame) => ({ t: frame.t, x: frame.x, y: frame.y, zoom: frame.zoom, ease: frame.ease ?? 'smooth' }))
}

export function formatTime(t: number): string {
  return `${t.toFixed(2)}s`
}
