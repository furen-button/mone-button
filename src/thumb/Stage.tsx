import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Layer, Project } from '../../scripts/create-video/thumbnail.js'
import { layerBox, prepareProject, renderProject } from './render'
import type { Box, Images } from './render'
export type Edit = (id: string, patch: Partial<Layer>, phase?: 'start' | 'move' | 'end') => void
function local(point: { x: number; y: number }, l: Layer) {
  const rad = (-l.rotation * Math.PI) / 180
  const dx = point.x - l.x
  const dy = point.y - l.y
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) }
}
export function Stage({
  project,
  selected,
  onSelect,
  onEdit,
  safeArea,
  ready,
  onError,
}: {
  project: Project
  selected: string | null
  onSelect: (id: string | null) => void
  onEdit: Edit
  safeArea: boolean
  ready: boolean
  onError: (message: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const imagesRef = useRef<Images>(new Map())
  const [box, setBox] = useState<Box | null>(null)
  const drag = useRef<{
    id: number
    layer: Layer
    point: { x: number; y: number }
    mode: 'move' | 'resize' | 'rotate'
    distance: number
    angle: number
  } | null>(null)
  const layer = project.layers.find((l) => l.id === selected)
  useEffect(() => {
    let active = true
    document.body.dataset.ready = '0'
    void prepareProject(project)
      .then((images) => {
        if (!active || !canvasRef.current) {
          return
        }
        imagesRef.current = images
        const ctx = canvasRef.current.getContext('2d')!
        renderProject(ctx, project, images)
        const selectedLayer = project.layers.find((l) => l.id === selected)
        setBox(selectedLayer && !selectedLayer.hidden ? layerBox(ctx, selectedLayer, images) : null)
        document.body.dataset.ready = ready ? '1' : '0'
      })
      .catch((error: unknown) => {
        if (active) {
          onError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      active = false
    }
  }, [project, selected, ready, onError])
  const latest = useRef({ layer, onEdit })
  useEffect(() => {
    latest.current = { layer, onEdit }
  })
  useEffect(() => {
    const svg = svgRef.current!
    const wheel = (e: WheelEvent) => {
      const { layer: l, onEdit: edit } = latest.current
      if (!l || l.locked) {
        return
      }
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0008)
      edit(l.id, scaled(l, factor))
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [])
  function point(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) * 1280) / rect.width, y: ((e.clientY - rect.top) * 720) / rect.height }
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    const p = point(e)
    const mode = (e.target as Element).getAttribute('data-mode') as 'resize' | 'rotate' | null
    const ctx = canvasRef.current!.getContext('2d')!
    const hit =
      mode && layer
        ? layer
        : [...project.layers].reverse().find((l) => {
            if (l.hidden || l.locked) {
              return false
            }
            const b = layerBox(ctx, l, imagesRef.current)
            const q = local(p, l)
            return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h
          })
    onSelect(hit?.id || null)
    if (!hit || hit.locked) {
      return
    }
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    onEdit(hit.id, {}, 'start')
    drag.current = {
      id: e.pointerId,
      layer: hit,
      point: p,
      mode: mode || 'move',
      distance: Math.max(1, Math.hypot(p.x - hit.x, p.y - hit.y)),
      angle: Math.atan2(p.y - hit.y, p.x - hit.x),
    }
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) {
      return
    }
    const p = point(e)
    const l = d.layer
    if (d.mode === 'move') {
      let x = l.x + p.x - d.point.x
      let y = l.y + p.y - d.point.y
      const b = layerBox(canvasRef.current!.getContext('2d')!, l, imagesRef.current)
      const angle = (l.rotation * Math.PI) / 180
      const cx = (b.x + b.w / 2) * Math.cos(angle) - (b.y + b.h / 2) * Math.sin(angle)
      const cy = (b.x + b.w / 2) * Math.sin(angle) + (b.y + b.h / 2) * Math.cos(angle)
      if (Math.abs(x + cx - 640) < 8) {
        x = 640 - cx
      }
      if (Math.abs(y + cy - 360) < 8) {
        y = 360 - cy
      }
      onEdit(l.id, { x, y }, 'move')
    } else if (d.mode === 'rotate') {
      onEdit(l.id, { rotation: l.rotation + ((Math.atan2(p.y - l.y, p.x - l.x) - d.angle) * 180) / Math.PI }, 'move')
    } else {
      onEdit(l.id, scaled(l, Math.hypot(p.x - l.x, p.y - l.y) / d.distance), 'move')
    }
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.id === e.pointerId) {
      const id = drag.current.layer.id
      drag.current = null
      onEdit(id, {}, 'end')
    }
  }
  return (
    <div className="th-stage">
      <canvas ref={canvasRef} width={1280} height={720} aria-label="サムネイル" />
      <svg
        ref={svgRef}
        tabIndex={0}
        viewBox="0 0 1280 720"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="レイヤー操作"
      >
        {safeArea && (
          <g pointerEvents="none">
            <rect x={1090} y={650} width={175} height={55} rx={6} fill="#0008" />
            <text x={1110} y={686} fill="#fff" fontSize={22}>
              再生時間
            </text>
          </g>
        )}
        {layer && box && (
          <g transform={`translate(${layer.x} ${layer.y}) rotate(${layer.rotation})`} className="th-selection">
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill="none"
              stroke="#71ecff"
              strokeWidth={3}
              pointerEvents="none"
            />
            {!layer.locked && (
              <>
                <line x1={box.x + box.w / 2} y1={box.y} x2={box.x + box.w / 2} y2={box.y - 35} stroke="#71ecff" />
                <circle data-mode="rotate" cx={box.x + box.w / 2} cy={box.y - 35} r={12} fill="#71ecff" />
                {[
                  [box.x, box.y],
                  [box.x + box.w, box.y],
                  [box.x, box.y + box.h],
                  [box.x + box.w, box.y + box.h],
                ].map(([x, y], i) => (
                  <rect key={i} data-mode="resize" x={x - 9} y={y - 9} width={18} height={18} fill="#71ecff" />
                ))}
              </>
            )}
          </g>
        )}
      </svg>
    </div>
  )
}
function scaled(l: Layer, factor: number): Partial<Layer> {
  if (l.type === 'image') {
    return { scale: Math.min(20, Math.max(0.01, l.scale * factor)) }
  }
  if (l.type === 'text') {
    return { size: Math.min(600, Math.max(1, l.size * factor)) }
  }
  return { w: Math.min(10000, Math.max(1, l.w * factor)), h: Math.min(10000, Math.max(1, l.h * factor)) }
}
