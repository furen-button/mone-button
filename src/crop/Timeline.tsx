import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { formatTime } from './geometry'
import { EASE_LABELS } from './types'
import type { CameraFrame } from './types'

type Props = {
  duration: number
  time: number
  keyframes: CameraFrame[]
  // 再生位置にあるキーフレームの番号（無ければ -1）。
  current: number
  playing: boolean
  onSeek: (t: number) => void
  onMoveKeyframe: (index: number, t: number) => void
  onTogglePlay: () => void
  onStep: (delta: number) => void
  onJump: (direction: -1 | 1) => void
  onAdd: () => void
  onDelete: () => void
}

type Drag = { kind: 'seek' } | { kind: 'key'; index: number }

// 再生位置・キーフレーム（◆）・区間ごとの動き（色）を 1 本の帯で見せる。
// 帯を押すとシーク、◆ を押すとその時刻へ移動し、横にドラッグすると時刻を変える。
export function Timeline({ duration, time, keyframes, current, playing, onSeek, onMoveKeyframe, onTogglePlay, onStep, onJump, onAdd, onDelete }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const percent = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`

  function timeFromPointer(event: ReactPointerEvent): number {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) {
      return 0
    }
    return Math.min(duration, Math.max(0, ((event.clientX - box.left) / box.width) * duration))
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    trackRef.current?.setPointerCapture(event.pointerId)
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key-index]')
    if (key) {
      const index = Number(key.dataset.keyIndex)
      dragRef.current = { kind: 'key', index }
      onSeek(keyframes[index].t)
      return
    }
    dragRef.current = { kind: 'seek' }
    onSeek(timeFromPointer(event))
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    if (drag.kind === 'seek') {
      onSeek(timeFromPointer(event))
    } else {
      onMoveKeyframe(drag.index, timeFromPointer(event))
    }
  }

  function handlePointerUp() {
    dragRef.current = null
  }

  return (
    <section className="cr-timeline" aria-label="タイムライン">
      <div className="cr-transport">
        <button type="button" onClick={() => onJump(-1)} title="前のキーフレーム（[）">⏮</button>
        <button type="button" onClick={() => onStep(-1)} title="1 フレーム戻る（←、Shift で 1 秒）">◀︎</button>
        <button type="button" className="cr-play" onClick={onTogglePlay} title="再生 / 停止（Space）">{playing ? '⏸' : '▶︎'}</button>
        <button type="button" onClick={() => onStep(1)} title="1 フレーム進む（→、Shift で 1 秒）">▶︎|</button>
        <button type="button" onClick={() => onJump(1)} title="次のキーフレーム（]）">⏭</button>
        <span className="cr-time">{formatTime(time)} / {formatTime(duration)}</span>
        <span className="cr-spacer" />
        <button type="button" onClick={onAdd} title="今の枠をキーフレームにする（K）">◆ キーフレーム追加</button>
        <button type="button" onClick={onDelete} disabled={current < 0} title="再生位置のキーフレームを消す（Delete）">削除</button>
      </div>
      <div
        ref={trackRef}
        className="cr-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {keyframes.slice(0, -1).map((frame, i) => (
          <span
            key={`seg-${frame.t}`}
            className={`cr-segment cr-segment-${frame.ease ?? 'smooth'}`}
            style={{ left: percent(frame.t), width: `calc(${percent(keyframes[i + 1].t)} - ${percent(frame.t)})` }}
            title={`${formatTime(frame.t)} → ${formatTime(keyframes[i + 1].t)}: ${EASE_LABELS[frame.ease ?? 'smooth']}`}
          />
        ))}
        {keyframes.map((frame, i) => (
          <span
            key={`key-${frame.t}`}
            data-key-index={i}
            className={`cr-key${i === current ? ' cr-keyCurrent' : ''}`}
            style={{ left: percent(frame.t) }}
            title={`${formatTime(frame.t)} · ${frame.zoom.toFixed(2)}x`}
          />
        ))}
        <span className="cr-playhead" style={{ left: percent(time) }} />
      </div>
      <p className="cr-legend">
        {(['smooth', 'linear', 'cut'] as const).map((ease) => (
          <span key={ease} className="cr-legendItem">
            <span className={`cr-swatch cr-segment-${ease}`} />
            {EASE_LABELS[ease]}
          </span>
        ))}
        <span className="cr-hint">Space 再生 · K 追加 · Delete 削除 · ←→ 1 フレーム · [ ] 前後のキーフレーム</span>
      </p>
    </section>
  )
}
