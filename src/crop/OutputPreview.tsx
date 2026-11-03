import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Rect } from './geometry'
import type { CameraAspect } from './types'

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>
  aspect: CameraAspect
  rect: Rect | null
  // 動画のフレームが変わった（シーク完了・再生中）ことを知らせる番号。同じ枠でも描き直す。
  frameVersion: number
}

const PREVIEW_HEIGHT = 520

// 完成形の目安。動画の今のフレームから枠の中をブラウザの拡大で描く（本番の拡大は「高画質で確認」で見る）。
export function OutputPreview({ videoRef, aspect, rect, frameVersion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [w, h] = aspect.split(':').map(Number)
  const height = aspect === '16:9' ? Math.round(PREVIEW_HEIGHT * 0.56) : PREVIEW_HEIGHT
  const width = Math.round(height * w / h)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || !rect || video.readyState < 2) {
      return
    }
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  }, [videoRef, rect, width, height, frameVersion])

  return (
    <div className="cr-output">
      <canvas ref={canvasRef} className="cr-outputCanvas" style={{ width, height }} aria-label={`完成形（${aspect}）`} />
      <p className="cr-outputCaption">
        {aspect} · {rect ? `枠 ${Math.round(rect.w)}×${Math.round(rect.h)}px` : '枠なし'}
      </p>
    </div>
  )
}
