import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { baseRect } from '../../scripts/create-video/camera.js'
import type { Rect, Size } from './geometry'
import type { CameraAspect } from './types'

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  source: Size | null
  aspect: CameraAspect
  rect: Rect | null
  // 今の時刻の枠の中心と倍率。ドラッグはここからの差分で決める。
  center: { x: number; y: number; zoom: number }
  onEdit: (patch: { x?: number; y?: number; zoom?: number }, phase: 'start' | 'move' | 'end') => void
  onVideoEvent: (event: 'metadata' | 'frame' | 'play' | 'pause') => void
}

type Drag =
  | { mode: 'move'; pointerId: number; startX: number; startY: number; center: { x: number; y: number } }
  | { mode: 'resize'; pointerId: number }

const HANDLE_PX = 14

// 元映像と切り出し枠。枠の中をドラッグで移動、四隅のドラッグとホイールで倍率、枠の外を押すとそこへ中心を移す。
export function SourceView({ videoRef, src, source, aspect, rect, center, onEdit, onVideoEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [display, setDisplay] = useState<{ width: number; height: number } | null>(null)
  const dragRef = useRef<Drag | null>(null)

  // canvas を動画の表示サイズに合わせる。
  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }
    const observer = new ResizeObserver(() => {
      setDisplay({ width: video.clientWidth, height: video.clientHeight })
    })
    observer.observe(video)
    return () => observer.disconnect()
  }, [videoRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !display || !source || !rect) {
      return
    }
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(display.width * ratio)
    canvas.height = Math.round(display.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawOverlay(ctx, display, toDisplayRect(rect, source, display))
  }, [display, source, rect])

  // React の onWheel は passive で preventDefault できないので、ネイティブで受けてページのスクロールを止める。
  const wheelRef = useRef({ center, onEdit })
  useEffect(() => {
    wheelRef.current = { center, onEdit }
  })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const { center: current, onEdit: edit } = wheelRef.current
      // マウスの 1 ノッチ（deltaY 100 前後）で約 8%。トラックパッドは細かい delta が連続で来る。
      edit({ zoom: current.zoom * Math.exp(-event.deltaY * 0.0008) }, 'move')
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  function toSource(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas || !source) {
      return null
    }
    const box = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * source.width,
      y: ((event.clientY - box.top) / box.height) * source.height,
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = toSource(event)
    if (!point || !rect || !source || !display) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const handle = HANDLE_PX * (source.width / display.width)
    const nearCorner = [
      [rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h],
    ].some(([cx, cy]) => Math.abs(point.x - cx) <= handle && Math.abs(point.y - cy) <= handle)
    onEdit({}, 'start')
    if (nearCorner) {
      dragRef.current = { mode: 'resize', pointerId: event.pointerId }
      return
    }
    const inside = point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
    let start = { x: center.x, y: center.y }
    if (!inside) {
      start = { x: point.x / source.width, y: point.y / source.height }
      onEdit(start, 'move')
    }
    dragRef.current = { mode: 'move', pointerId: event.pointerId, startX: point.x, startY: point.y, center: start }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    const point = toSource(event)
    if (!drag || drag.pointerId !== event.pointerId || !point || !source) {
      return
    }
    if (drag.mode === 'move') {
      onEdit({
        x: drag.center.x + (point.x - drag.startX) / source.width,
        y: drag.center.y + (point.y - drag.startY) / source.height,
      }, 'move')
      return
    }
    // 四隅は中心を固定したまま、ポインタまでの縦横の遠いほうに枠を合わせる。
    const base = baseRect(source, aspect)
    const halfW = Math.abs(point.x - center.x * source.width)
    const halfH = Math.abs(point.y - center.y * source.height)
    const zoom = Math.min(base.w / Math.max(1, halfW * 2), base.h / Math.max(1, halfH * 2))
    onEdit({ zoom }, 'move')
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      onEdit({}, 'end')
    }
  }

  return (
    <div className="cr-sourceFrame">
      <video
        ref={videoRef}
        className="cr-video"
        src={src}
        preload="auto"
        playsInline
        onLoadedMetadata={() => onVideoEvent('metadata')}
        onLoadedData={() => onVideoEvent('frame')}
        onSeeked={() => onVideoEvent('frame')}
        onPlay={() => onVideoEvent('play')}
        onPause={() => onVideoEvent('pause')}
      />
      <canvas
        ref={canvasRef}
        className="cr-overlay"
        style={display ? { width: display.width, height: display.height } : undefined}
        aria-label="切り出し枠（ドラッグで移動、四隅とホイールで倍率）"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}

function toDisplayRect(rect: Rect, source: Size, display: { width: number; height: number }): Rect {
  const sx = display.width / source.width
  const sy = display.height / source.height
  return { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy }
}

// 枠の外を暗くし、枠・三分割線・四隅の持ち手を描く。
function drawOverlay(ctx: CanvasRenderingContext2D, display: { width: number; height: number }, rect: Rect) {
  ctx.clearRect(0, 0, display.width, display.height)
  ctx.fillStyle = 'rgba(8, 8, 12, 0.66)'
  ctx.beginPath()
  ctx.rect(0, 0, display.width, display.height)
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.fill('evenodd')

  ctx.strokeStyle = 'rgba(255, 248, 242, 0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const ratio of [1 / 3, 2 / 3]) {
    ctx.moveTo(rect.x + rect.w * ratio, rect.y)
    ctx.lineTo(rect.x + rect.w * ratio, rect.y + rect.h)
    ctx.moveTo(rect.x, rect.y + rect.h * ratio)
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h * ratio)
  }
  ctx.stroke()

  ctx.strokeStyle = '#ffc6e2'
  ctx.lineWidth = 2
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)

  ctx.fillStyle = '#ffc6e2'
  const size = 9
  for (const [x, y] of [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]) {
    ctx.fillRect(x - size / 2, y - size / 2, size, size)
  }
}
