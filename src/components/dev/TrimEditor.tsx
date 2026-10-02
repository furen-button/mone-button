import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { VoiceClip, VoiceData } from '../../voiceData'
import { trimClipData } from '../../lib/devDataEditor'
import { withVideoCacheBust } from '../../lib/videoPath'

type TrimEditorProps = {
  clip: VoiceClip
  onSaved: (fileBaseName: string, updated: VoiceData, options?: { cacheBustVideo?: boolean }) => void
}

type LoadStatus = 'loading' | 'ready' | 'error'
type TrimStatus = 'idle' | 'trimming' | 'trimmed' | 'error'
type DragHandle = 'start' | 'end'

type WaveformPeaks = {
  width: number
  mins: Float32Array
  maxes: Float32Array
  // 正規化済みで音量が小さいクリップでも形が読めるよう、最大振幅で縦方向を揃える。
  peak: number
}

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

const MIN_SELECTION_SECONDS = 0.3
const NUDGE_SECONDS = 0.05
const FINE_NUDGE_SECONDS = 0.01
// 末尾の無音判定。最も大きい窓から -30dB を下回ったら無音とみなす（BGM や環境音が乗るクリップ向けに相対にする）。
const TAIL_RELATIVE_DB = -30
const TAIL_FLOOR_DB = -50
const WAVEFORM_HEIGHT = 128

export function TrimEditor({ clip, onSaved }: TrimEditorProps) {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [trimStatus, setTrimStatus] = useState<TrimStatus>('idle')
  const [trimError, setTrimError] = useState('')
  const [audioReloadKey, setAudioReloadKey] = useState(() => Date.now())
  const [canvasWidth, setCanvasWidth] = useState(1)
  const [keepStart, setKeepStart] = useState(0)
  const [keepEnd, setKeepEnd] = useState(Math.max(clip.trimming.duration, MIN_SELECTION_SECONDS))
  const [draggingHandle, setDraggingHandle] = useState<DragHandle | null>(null)
  const [playheadTime, setPlayheadTime] = useState<number | null>(null)

  const waveformWrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const playbackRef = useRef<{ startedAt: number, start: number, end: number } | null>(null)
  const keepStartRef = useRef(keepStart)
  const keepEndRef = useRef(keepEnd)
  const durationRef = useRef(keepEnd)
  const dragHandleRef = useRef<DragHandle | null>(null)

  const duration = audioBuffer?.duration ?? Math.max(clip.trimming.duration, MIN_SELECTION_SECONDS)
  const selectionDuration = Math.max(0, keepEnd - keepStart)
  const tailCut = Math.max(0, duration - keepEnd)
  const startPercent = duration > 0 ? clamp(keepStart / duration * 100, 0, 100) : 0
  const endPercent = duration > 0 ? clamp(keepEnd / duration * 100, 0, 100) : 100
  const hasMeaningfulTrim = keepStart >= 0.01 || duration - keepEnd >= 0.01
  const canTrim = loadStatus === 'ready'
    && trimStatus !== 'trimming'
    && selectionDuration >= MIN_SELECTION_SECONDS
    && hasMeaningfulTrim

  useEffect(() => {
    keepStartRef.current = keepStart
  }, [keepStart])

  useEffect(() => {
    keepEndRef.current = keepEnd
  }, [keepEnd])

  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const audioWindow = window as AudioWindow
      const AudioContextClass = window.AudioContext ?? audioWindow.webkitAudioContext
      if (!AudioContextClass) {
        throw new Error('AudioContext が使えません')
      }
      audioContextRef.current = new AudioContextClass()
    }
    return audioContextRef.current
  }, [])

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        // すでに終了済みの場合は何もしない。
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    playbackRef.current = null
    setPlayheadTime(null)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadAudio() {
      stopPlayback()
      setAudioBuffer(null)
      setLoadStatus('loading')
      setLoadError('')
      setTrimStatus('idle')
      setTrimError('')

      try {
        const response = await fetch(withVideoCacheBust(clip.videoPath, audioReloadKey), {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`動画の読み込みに失敗しました (${response.status})`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const decoded = await getAudioContext().decodeAudioData(arrayBuffer.slice(0))
        if (cancelled) {
          return
        }

        setAudioBuffer(decoded)
        setKeepStart(0)
        setKeepEnd(decoded.duration)
        setLoadStatus('ready')
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setLoadStatus('error')
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    }

    void loadAudio()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [audioReloadKey, clip.fileBaseName, clip.videoPath, getAudioContext, stopPlayback])

  useEffect(() => {
    const element = waveformWrapRef.current
    if (!element) {
      return
    }

    const updateWidth = () => {
      setCanvasWidth(Math.max(1, Math.round(element.clientWidth)))
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      stopPlayback()
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [stopPlayback])

  const waveform = useMemo(() => {
    if (!audioBuffer || canvasWidth <= 0) {
      return null
    }
    return buildWaveformPeaks(audioBuffer, canvasWidth)
  }, [audioBuffer, canvasWidth])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(waveform.width * dpr))
    canvas.height = Math.round(WAVEFORM_HEIGHT * dpr)
    canvas.style.height = `${WAVEFORM_HEIGHT}px`

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawWaveform({
      context,
      waveform,
      duration,
      keepStart,
      keepEnd,
      playheadTime,
    })
  }, [duration, keepEnd, keepStart, playheadTime, waveform])

  const timeFromClientX = useCallback((clientX: number) => {
    const element = waveformWrapRef.current
    const currentDuration = durationRef.current
    if (!element || currentDuration <= 0) {
      return 0
    }

    const rect = element.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
    return ratio * currentDuration
  }, [])

  const setHandleTime = useCallback((handle: DragHandle, time: number) => {
    const currentStart = keepStartRef.current
    const currentEnd = keepEndRef.current
    const currentDuration = durationRef.current

    // 連打で古い値を読まないよう、state の反映を待たずに ref も更新する。
    if (handle === 'start') {
      const next = clamp(time, 0, Math.max(0, currentEnd - MIN_SELECTION_SECONDS))
      keepStartRef.current = next
      setKeepStart(next)
      return
    }

    const next = clamp(time, Math.min(currentDuration, currentStart + MIN_SELECTION_SECONDS), currentDuration)
    keepEndRef.current = next
    setKeepEnd(next)
  }, [])

  const beginDrag = useCallback((handle: DragHandle, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragHandleRef.current = handle
    setDraggingHandle(handle)
    setHandleTime(handle, timeFromClientX(event.clientX))
  }, [setHandleTime, timeFromClientX])

  const handleWaveformPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (loadStatus !== 'ready') {
      return
    }

    const time = timeFromClientX(event.clientX)
    const handle = Math.abs(time - keepStartRef.current) <= Math.abs(time - keepEndRef.current)
      ? 'start'
      : 'end'
    beginDrag(handle, event)
  }, [beginDrag, loadStatus, timeFromClientX])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const handle = dragHandleRef.current
      if (!handle) {
        return
      }
      event.preventDefault()
      setHandleTime(handle, timeFromClientX(event.clientX))
    }

    const handlePointerUp = () => {
      dragHandleRef.current = null
      setDraggingHandle(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [setHandleTime, timeFromClientX])

  const nudgeHandle = useCallback((handle: DragHandle, direction: -1 | 1, event: ReactMouseEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? FINE_NUDGE_SECONDS : NUDGE_SECONDS
    const baseTime = handle === 'start' ? keepStartRef.current : keepEndRef.current
    setHandleTime(handle, baseTime + direction * step)
  }, [setHandleTime])

  const applyTailSuggestion = useCallback(() => {
    if (!audioBuffer) {
      return
    }

    const suggestedEnd = findTailSuggestion(audioBuffer)
    setHandleTime('end', suggestedEnd)
  }, [audioBuffer, setHandleTime])

  const startPlayback = useCallback(async (start: number, end: number) => {
    if (!audioBuffer || end <= start) {
      return
    }

    const context = getAudioContext()
    await context.resume()
    stopPlayback()

    const source = context.createBufferSource()
    source.buffer = audioBuffer
    source.connect(context.destination)
    sourceRef.current = source

    const playback = { startedAt: context.currentTime, start, end }
    playbackRef.current = playback
    setPlayheadTime(start)

    const tick = () => {
      if (playbackRef.current !== playback) {
        return
      }

      const current = playback.start + (context.currentTime - playback.startedAt)
      if (current < playback.end) {
        setPlayheadTime(current)
        rafRef.current = window.requestAnimationFrame(tick)
        return
      }

      setPlayheadTime(null)
      rafRef.current = null
      playbackRef.current = null
    }

    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null
        playbackRef.current = null
        setPlayheadTime(null)
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      }
    }

    source.start(0, start, Math.max(0.01, end - start))
    rafRef.current = window.requestAnimationFrame(tick)
  }, [audioBuffer, getAudioContext, stopPlayback])

  const handleTrim = useCallback(async () => {
    setTrimStatus('trimming')
    setTrimError('')
    stopPlayback()

    try {
      const updated = await trimClipData(clip.fileBaseName, keepStart, keepEnd)
      onSaved(clip.fileBaseName, updated, { cacheBustVideo: true })
      setTrimStatus('trimmed')
      setAudioReloadKey(Date.now())
    } catch (error) {
      setTrimStatus('error')
      setTrimError(error instanceof Error ? error.message : String(error))
    }
  }, [clip.fileBaseName, keepEnd, keepStart, onSaved, stopPlayback])

  return (
    <section className="clip-trim" aria-label="波形トリム">
      <div className="clip-trim-header">
        <div>
          <h3 className="clip-trim-title">波形トリム</h3>
          <p className="clip-trim-range">
            残す範囲 {formatSeconds(keepStart)}–{formatSeconds(keepEnd)} / {formatSeconds(duration)} 秒
          </p>
        </div>
        <p className="clip-trim-tail">末尾 −{formatSeconds(tailCut)} 秒</p>
      </div>

      <div
        className={`clip-trim-waveform ${draggingHandle ? 'is-dragging' : ''}`}
        ref={waveformWrapRef}
        onPointerDown={handleWaveformPointerDown}
      >
        <canvas
          ref={canvasRef}
          className="clip-trim-canvas"
          aria-hidden="true"
        />
        {loadStatus === 'ready' ? (
          <>
            <button
              type="button"
              className={`clip-trim-handle clip-trim-handle-start ${draggingHandle === 'start' ? 'is-active' : ''}`}
              style={{ left: `${startPercent}%` }}
              aria-label="開始位置"
              onPointerDown={(event) => beginDrag('start', event)}
            />
            <button
              type="button"
              className={`clip-trim-handle clip-trim-handle-end ${draggingHandle === 'end' ? 'is-active' : ''}`}
              style={{ left: `${endPercent}%` }}
              aria-label="終了位置"
              onPointerDown={(event) => beginDrag('end', event)}
            />
          </>
        ) : null}
      </div>

      {loadStatus === 'loading' ? <p className="clip-trim-status">波形を読み込み中…</p> : null}
      {loadStatus === 'error' ? <p className="clip-trim-status is-error">⚠ {loadError}</p> : null}

      <div className="clip-trim-controls">
        <div className="clip-trim-nudge">
          <span className="clip-trim-control-label">先頭</span>
          <button type="button" onClick={(event) => nudgeHandle('start', -1, event)} disabled={loadStatus !== 'ready'}>
            −
          </button>
          <button type="button" onClick={(event) => nudgeHandle('start', 1, event)} disabled={loadStatus !== 'ready'}>
            ＋
          </button>
        </div>
        <div className="clip-trim-nudge">
          <span className="clip-trim-control-label">末尾</span>
          <button type="button" onClick={(event) => nudgeHandle('end', -1, event)} disabled={loadStatus !== 'ready'}>
            −
          </button>
          <button type="button" onClick={(event) => nudgeHandle('end', 1, event)} disabled={loadStatus !== 'ready'}>
            ＋
          </button>
        </div>
        <button
          type="button"
          className="clip-trim-secondary"
          onClick={applyTailSuggestion}
          disabled={loadStatus !== 'ready'}
        >
          末尾を無音手前へ
        </button>
      </div>

      <div className="clip-trim-actions">
        <button
          type="button"
          className="clip-trim-secondary"
          onClick={() => void startPlayback(keepStart, keepEnd)}
          disabled={loadStatus !== 'ready'}
        >
          選択範囲を再生
        </button>
        <button
          type="button"
          className="clip-trim-secondary"
          onClick={() => void startPlayback(Math.max(keepStart, keepEnd - 1), keepEnd)}
          disabled={loadStatus !== 'ready'}
        >
          末尾 1 秒だけ再生
        </button>
        <button
          type="button"
          className="clip-trim-save"
          onClick={() => void handleTrim()}
          disabled={!canTrim}
        >
          {trimStatus === 'trimming' ? '切り直し中…' : 'この範囲で切る'}
        </button>
      </div>

      {trimStatus === 'trimmed' ? <p className="clip-trim-status is-saved">切り直しました。</p> : null}
      {trimStatus === 'error' ? <p className="clip-trim-status is-error">⚠ {trimError}</p> : null}
    </section>
  )
}

function buildWaveformPeaks(buffer: AudioBuffer, width: number): WaveformPeaks {
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  const mins = new Float32Array(width)
  const maxes = new Float32Array(width)
  const samplesPerPixel = Math.max(1, Math.ceil(buffer.length / width))

  for (let x = 0; x < width; x += 1) {
    const start = x * samplesPerPixel
    const end = Math.min(buffer.length, start + samplesPerPixel)
    let min = 1
    let max = -1

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let mixed = 0
      for (const channel of channelData) {
        mixed += channel[sampleIndex] ?? 0
      }
      mixed /= Math.max(channelData.length, 1)
      min = Math.min(min, mixed)
      max = Math.max(max, mixed)
    }

    mins[x] = min
    maxes[x] = max
  }

  let peak = 0
  for (let x = 0; x < width; x += 1) {
    peak = Math.max(peak, Math.abs(mins[x]), Math.abs(maxes[x]))
  }

  return { width, mins, maxes, peak: Math.max(peak, 1e-4) }
}

function drawWaveform({
  context,
  waveform,
  duration,
  keepStart,
  keepEnd,
  playheadTime,
}: {
  context: CanvasRenderingContext2D
  waveform: WaveformPeaks
  duration: number
  keepStart: number
  keepEnd: number
  playheadTime: number | null
}) {
  const width = waveform.width
  const height = WAVEFORM_HEIGHT
  const middle = height / 2

  context.clearRect(0, 0, width, height)
  context.fillStyle = '#fff7ed'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#ead8c4'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(0, middle)
  context.lineTo(width, middle)
  context.stroke()

  context.strokeStyle = '#6a54b8'
  context.lineWidth = 1
  context.beginPath()
  for (let x = 0; x < width; x += 1) {
    const min = waveform.mins[x]
    const max = waveform.maxes[x]
    const y1 = middle + min / waveform.peak * (height * 0.45)
    const y2 = middle + max / waveform.peak * (height * 0.45)
    context.moveTo(x + 0.5, y1)
    context.lineTo(x + 0.5, y2)
  }
  context.stroke()

  const startX = duration > 0 ? keepStart / duration * width : 0
  const endX = duration > 0 ? keepEnd / duration * width : width
  context.fillStyle = 'rgba(45, 31, 24, 0.28)'
  context.fillRect(0, 0, Math.max(0, startX), height)
  context.fillRect(Math.min(width, endX), 0, Math.max(0, width - endX), height)

  context.fillStyle = 'rgba(255, 198, 226, 0.18)'
  context.fillRect(startX, 0, Math.max(0, endX - startX), height)

  if (playheadTime !== null && duration > 0) {
    const playheadX = clamp(playheadTime / duration * width, 0, width)
    context.strokeStyle = '#d33f49'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(playheadX, 0)
    context.lineTo(playheadX, height)
    context.stroke()
  }
}

function findTailSuggestion(buffer: AudioBuffer): number {
  const windowSize = Math.max(256, Math.floor(buffer.sampleRate * 0.03))
  const step = Math.max(128, Math.floor(buffer.sampleRate * 0.01))
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))

  // 窓の終端サンプル位置と RMS を末尾から並べる。
  const windows: Array<{ end: number, rms: number }> = []
  for (let end = buffer.length; end > 0; end -= step) {
    const start = Math.max(0, end - windowSize)
    let sum = 0

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let mixed = 0
      for (const channel of channelData) {
        mixed += channel[sampleIndex] ?? 0
      }
      mixed /= Math.max(channelData.length, 1)
      sum += mixed * mixed
    }

    windows.push({ end, rms: Math.sqrt(sum / Math.max(end - start, 1)) })
  }

  const loudest = windows.reduce((max, entry) => Math.max(max, entry.rms), 0)
  const threshold = Math.max(10 ** (TAIL_FLOOR_DB / 20), loudest * 10 ** (TAIL_RELATIVE_DB / 20))

  // windows は末尾から並んでいるので、最初に閾値を超えた窓が最後の有音区間。
  for (const entry of windows) {
    if (entry.rms > threshold) {
      return clamp(entry.end / buffer.sampleRate + 0.1, MIN_SELECTION_SECONDS, buffer.duration)
    }
  }

  return buffer.duration
}

function formatSeconds(value: number): string {
  return value.toFixed(2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
