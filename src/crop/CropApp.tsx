import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { cancelJob, EditorApiError, fileUrl, getJob, saveClipData } from '../editor/api'
import type { JobSummary } from '../editor/types'
import { ClipPanel } from './ClipPanel'
import { getClip, renderCropStill, startCropExport, uploadVideo } from './cropApi'
import { ExportPanel } from './ExportPanel'
import type { SourceOption } from './ExportPanel'
import {
  clampCenter,
  clampZoom,
  frameAt,
  keyframeIndexAt,
  moveKeyframe,
  rectAt,
  sameTrack,
  setEase,
  upsertKeyframe,
} from './geometry'
import { KeyframeFields } from './KeyframeFields'
import { OutputPreview } from './OutputPreview'
import { SourceView } from './SourceView'
import { Timeline } from './Timeline'
import { ASPECTS, EXPORT_SIZES } from './types'
import type { CameraAspect, CameraFrame, ClipMatch, CropRequest, CropStillMeta, Ease, Scaler, Tracks } from './types'

type Media = { url: string; name: string; size: number; objectUrl: boolean }
type Notice = { kind: 'info' | 'error'; text: string }

const EMPTY_TRACKS: Tracks = { '9:16': [], '16:9': [], '1:1': [] }
const VIDEO_PATTERN = /\.(mp4|m4v|mov|webm|mkv)$/iu

// 切り出しツール。任意の動画をドロップし、元映像の上の枠とキーフレームで切り出しを決め、
// mp4 を書き出す。public/data のクリップならキーフレームを effects.camera に保存して createVideo にも効かせる。
export function CropApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const uploadRef = useRef<{ abort: () => void } | null>(null)
  const initialAtRef = useRef<number | null>(null)
  const [media, setMedia] = useState<Media | null>(null)
  const [serverSource, setServerSource] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [clip, setClip] = useState<ClipMatch | null>(null)
  const [video, setVideo] = useState<{ width: number; height: number; duration: number } | null>(null)
  const [fps, setFps] = useState(30)
  const [aspect, setAspect] = useState<CameraAspect>(() => initialAspect())
  const [tracks, setTracks] = useState<Tracks>(EMPTY_TRACKS)
  const [time, setTime] = useState(0)
  const [frameVersion, setFrameVersion] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [size, setSize] = useState(EXPORT_SIZES[initialAspect()][0])
  const [scaler, setScaler] = useState<Scaler>('anime4k')
  const [exportSource, setExportSource] = useState<string | null>(null)
  const [job, setJob] = useState<JobSummary | null>(null)
  const [jobOut, setJobOut] = useState<string | null>(null)
  const [still, setStill] = useState<{ url: string; meta: CropStillMeta } | null>(null)
  const [stillBusy, setStillBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const keyframes = tracks[aspect]
  const source = useMemo(() => (video ? { width: video.width, height: video.height } : null), [video])
  const frame = frameAt(keyframes, time)
  const currentIndex = keyframeIndexAt(keyframes, time, fps)
  const rect = source ? rectAt(keyframes, time, source, aspect) : null
  const cacheSource = clip?.sources.find((entry) => entry.source.startsWith('cache:')) ?? null

  const applyClip = useCallback((matched: ClipMatch) => {
    setClip(matched)
    setTracks({ ...EMPTY_TRACKS, ...matched.camera })
    const saved = ASPECTS.find((key) => matched.camera[key]?.length)
    if (saved) {
      setAspect(saved)
      setSize(EXPORT_SIZES[saved][0])
    }
  }, [])

  const resetForMedia = useCallback((next: Media) => {
    uploadRef.current?.abort()
    setMedia((previous) => {
      if (previous?.objectUrl) {
        URL.revokeObjectURL(previous.url)
      }
      return next
    })
    setServerSource(null)
    setExportSource(null)
    setClip(null)
    setVideo(null)
    setTracks(EMPTY_TRACKS)
    setTime(0)
    setJob(null)
    setJobOut(null)
    setStill(null)
    setNotice(null)
  }, [])

  // ?clip=<base>&at=<秒>&aspect=<9:16> で public/data のクリップを開く（shots と dev モーダルからの入口）。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const base = params.get('clip')
    if (!base) {
      return
    }
    const at = Number(params.get('at'))
    initialAtRef.current = Number.isFinite(at) && at > 0 ? at : null
    let cancelled = false
    getClip(base)
      .then((matched) => {
        if (cancelled) {
          return
        }
        if (!matched) {
          setNotice({ kind: 'error', text: `クリップが見つかりません: ${base}` })
          return
        }
        const preferred = matched.sources.find((entry) => entry.source.startsWith('cache:')) ?? matched.sources[0]
        if (!preferred) {
          setNotice({ kind: 'error', text: `サーバ上に元動画がありません: ${base}` })
          return
        }
        resetForMedia({ url: fileUrl('crop-source', preferred.source), name: base, size: preferred.size, objectUrl: false })
        setServerSource(preferred.source)
        setFps(preferred.probe?.fps || 30)
        applyClip(matched)
        if (params.get('aspect')) {
          setAspect(initialAspect())
          setSize(EXPORT_SIZES[initialAspect()][0])
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNotice({ kind: 'error', text: errorText(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [applyClip, resetForMedia])

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/') && !VIDEO_PATTERN.test(file.name)) {
      setNotice({ kind: 'error', text: `動画ファイルではありません: ${file.name}` })
      return
    }
    initialAtRef.current = null
    resetForMedia({ url: URL.createObjectURL(file), name: file.name, size: file.size, objectUrl: true })

    // ファイル名がクリップ名なら照合し、サーバ上に同じ大きさの元動画があればアップロードを省く。
    const base = file.name.replace(/\.[^.]+$/u, '')
    let matched: ClipMatch | null = null
    if (/^[\w-]+$/u.test(base)) {
      matched = await getClip(base).catch(() => null)
    }
    if (matched) {
      applyClip(matched)
      const same = matched.sources.find((entry) => entry.size === file.size)
      if (same) {
        setServerSource(same.source)
        setFps(same.probe?.fps || 30)
        setNotice({ kind: 'info', text: 'サーバ上の同じ動画を使います（アップロードを省きました）。' })
        return
      }
    }
    setUploadProgress(0)
    const task = uploadVideo(file, setUploadProgress)
    uploadRef.current = task
    try {
      const result = await task.promise
      setServerSource(result.source)
      setFps(result.probe.fps || 30)
      if (result.clip && !matched) {
        applyClip(result.clip)
      }
    } catch (error) {
      if (!(error instanceof EditorApiError && error.status === 499)) {
        setNotice({ kind: 'error', text: `アップロードに失敗しました: ${errorText(error)}` })
      }
    } finally {
      setUploadProgress(null)
    }
  }, [applyClip, resetForMedia])

  // 再生中は rAF で時刻を追う（timeupdate は 4Hz 程度で枠の追従が粗い）。
  useEffect(() => {
    if (!playing) {
      return
    }
    let handle = 0
    const tick = () => {
      const element = videoRef.current
      if (element) {
        setTime(element.currentTime)
        setFrameVersion((version) => version + 1)
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing])

  const handleVideoEvent = useCallback((event: 'metadata' | 'frame' | 'play' | 'pause') => {
    const element = videoRef.current
    if (!element) {
      return
    }
    if (event === 'metadata') {
      setVideo({ width: element.videoWidth, height: element.videoHeight, duration: element.duration })
      if (initialAtRef.current !== null) {
        element.currentTime = Math.min(initialAtRef.current, element.duration)
        initialAtRef.current = null
      }
    } else if (event === 'frame') {
      setTime(element.currentTime)
      setFrameVersion((version) => version + 1)
    } else {
      setPlaying(event === 'play')
    }
  }, [])

  const seek = useCallback((t: number) => {
    const element = videoRef.current
    if (!element || !video) {
      return
    }
    const clamped = Math.min(video.duration, Math.max(0, t))
    element.currentTime = clamped
    setTime(clamped)
  }, [video])

  const updateTrack = useCallback((next: CameraFrame[]) => {
    setTracks((previous) => ({ ...previous, [aspect]: next }))
  }, [aspect])

  // 枠の操作・数値の変更。再生位置のキーフレームを書き換え、無ければ差し込む。
  const editFrame = useCallback((patch: { x?: number; y?: number; zoom?: number; ease?: Ease }) => {
    if (!source) {
      return
    }
    const current = frameAt(keyframes, time)
    const zoom = clampZoom(patch.zoom ?? current.zoom)
    const center = clampCenter({ x: patch.x ?? current.x, y: patch.y ?? current.y, zoom }, source, aspect)
    const next = upsertKeyframe(keyframes, time, { ...center, zoom, ...(patch.ease ? { ease: patch.ease } : {}) }, fps)
    updateTrack(next.keyframes)
  }, [aspect, fps, keyframes, source, time, updateTrack])

  const handleEdit = useCallback((patch: { x?: number; y?: number; zoom?: number }, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      // 再生しながら動かすと時刻ごとにキーフレームが増えるので止める。
      videoRef.current?.pause()
      return
    }
    if (phase === 'move' && Object.keys(patch).length > 0) {
      editFrame(patch)
    }
  }, [editFrame])

  const handleFieldChange = useCallback((patch: { t?: number; x?: number; y?: number; zoom?: number; ease?: Ease }) => {
    if (patch.t !== undefined) {
      if (currentIndex >= 0 && video) {
        const next = moveKeyframe(keyframes, currentIndex, patch.t, fps, video.duration)
        updateTrack(next)
        seek(next[currentIndex].t)
      }
      return
    }
    if (patch.ease && currentIndex >= 0) {
      updateTrack(setEase(keyframes, currentIndex, patch.ease))
      return
    }
    editFrame(patch)
  }, [currentIndex, editFrame, fps, keyframes, seek, updateTrack, video])

  const addKeyframe = useCallback(() => {
    if (source) {
      updateTrack(upsertKeyframe(keyframes, time, {}, fps).keyframes)
    }
  }, [fps, keyframes, source, time, updateTrack])

  const deleteKeyframe = useCallback(() => {
    if (currentIndex >= 0) {
      updateTrack(keyframes.filter((_, i) => i !== currentIndex))
    }
  }, [currentIndex, keyframes, updateTrack])

  const jump = useCallback((direction: -1 | 1) => {
    const epsilon = 0.5 / fps
    const target = direction < 0
      ? [...keyframes].reverse().find((entry) => entry.t < time - epsilon)
      : keyframes.find((entry) => entry.t > time + epsilon)
    if (target) {
      seek(target.t)
    }
  }, [fps, keyframes, seek, time])

  const togglePlay = useCallback(() => {
    const element = videoRef.current
    if (!element) {
      return
    }
    if (element.paused) {
      void element.play()
    } else {
      element.pause()
    }
  }, [])

  const step = useCallback((frames: number) => {
    seek(time + frames / fps)
  }, [fps, seek, time])

  // キーボード操作。入力欄にフォーカスがあるときは奪わない。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.closest('input, select, textarea') || target.isContentEditable)) {
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'k' || event.key === 'K') {
        addKeyframe()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteKeyframe()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const sign = event.key === 'ArrowLeft' ? -1 : 1
        if (event.shiftKey) {
          seek(time + sign)
        } else {
          step(sign)
        }
      } else if (event.key === '[') {
        jump(-1)
      } else if (event.key === ']') {
        jump(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addKeyframe, deleteKeyframe, jump, seek, step, time, togglePlay])

  const changeAspect = useCallback((next: CameraAspect) => {
    setAspect(next)
    setSize(EXPORT_SIZES[next][0])
    setStill(null)
  }, [])

  // 書き出しの元にする動画。クリップの高画質キャッシュがあれば既定にする。
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const options: SourceOption[] = []
    if (cacheSource) {
      const probe = cacheSource.probe
      options.push({ source: cacheSource.source, label: `高画質キャッシュ${probe ? `（${probe.width}×${probe.height}）` : ''}` })
    }
    if (serverSource && serverSource !== cacheSource?.source) {
      const label = serverSource.startsWith('public:') ? 'サイト用の動画（256×144）' : 'ドロップしたファイル'
      options.push({ source: serverSource, label: `${label}${video ? `（${video.width}×${video.height}）` : ''}` })
    }
    return options
  }, [cacheSource, serverSource, video])
  const chosenSource = exportSource && sourceOptions.some((option) => option.source === exportSource)
    ? exportSource
    : sourceOptions[0]?.source ?? null

  const request = useMemo<CropRequest | null>(() => (
    chosenSource && keyframes.length > 0 ? { source: chosenSource, keyframes, aspect, size, scaler } : null
  ), [aspect, chosenSource, keyframes, scaler, size])
  let blocked: string | null = null
  if (uploadProgress !== null) {
    blocked = 'アップロードが終わるまで待ってください。'
  } else if (!chosenSource) {
    blocked = '動画をサーバに送れていません。'
  } else if (keyframes.length === 0) {
    blocked = '枠を動かすか K でキーフレームを作ってください。'
  }

  const renderStill = useCallback(async () => {
    if (!request) {
      return
    }
    setStillBusy(true)
    try {
      const { blob, meta } = await renderCropStill({ ...request, at: time })
      setStill((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous.url)
        }
        return { url: URL.createObjectURL(blob), meta }
      })
    } catch (error) {
      setNotice({ kind: 'error', text: `確認画像を作れませんでした: ${errorText(error)}` })
    } finally {
      setStillBusy(false)
    }
  }, [request, time])

  const startExport = useCallback(async () => {
    if (!request) {
      return
    }
    try {
      const started = await startCropExport(request)
      setJob(started.job)
      setJobOut(started.outName)
    } catch (error) {
      const busy = error instanceof EditorApiError && error.status === 409
      setNotice({ kind: 'error', text: busy ? 'createVideo のビルドなど別のジョブが実行中です。終わってから書き出してください。' : errorText(error) })
    }
  }, [request])

  // 書き出しの進捗は 1 秒ごとにジョブの要約を取り直す。
  useEffect(() => {
    if (job?.state !== 'running') {
      return
    }
    const timer = window.setTimeout(() => {
      getJob(job.id).then(setJob).catch((error: unknown) => setNotice({ kind: 'error', text: errorText(error) }))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [job])

  const cancelExport = useCallback(async () => {
    if (job) {
      await cancelJob(job.id).catch(() => undefined)
      setJob(await getJob(job.id).catch(() => job))
    }
  }, [job])

  const saveToClip = useCallback(async (next: CameraFrame[] | null) => {
    if (!clip) {
      return
    }
    setSaving(true)
    try {
      const saved = await saveClipData({ fileBaseName: clip.base, camera: { aspect, keyframes: next } })
      const effects = saved.effects as { camera?: ClipMatch['camera'] } | undefined
      setClip({ ...clip, camera: effects?.camera ?? {} })
      setNotice({ kind: 'info', text: next ? `${aspect} のキーフレームを保存しました。` : `${aspect} の設定を消しました。` })
    } catch (error) {
      setNotice({ kind: 'error', text: `保存できませんでした: ${errorText(error)}` })
    } finally {
      setSaving(false)
    }
  }, [aspect, clip])

  const removeFromClip = useCallback(() => {
    if (window.confirm(`${clip?.base} の ${aspect} の切り出し設定を消します。よろしいですか？`)) {
      updateTrack([])
      void saveToClip(null)
    }
  }, [aspect, clip, saveToClip, updateTrack])

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) {
      void loadFile(file)
    }
  }

  const resultUrl = job?.state === 'done' && jobOut ? fileUrl('crop', jobOut) : null
  const dirty = Boolean(clip) && !sameTrack(keyframes, clip?.camera[aspect])

  return (
    <div
      className="cr-shell"
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragOver(false)
        }
      }}
      onDrop={handleDrop}
    >
      <header className="cr-topbar">
        <div className="cr-titleBlock">
          <span className="cv-devBadge">DEV</span>
          <h1>切り出しツール</h1>
          <p className="cr-summary">
            {media
              ? `${media.name}${video ? ` · ${video.width}×${video.height} · ${video.duration.toFixed(2)}s` : ''}${clip ? ' · クリップと一致' : ''}`
              : '動画をドラッグ＆ドロップして、枠とキーフレームで切り出します'}
          </p>
        </div>
        <div className="cr-aspects" role="group" aria-label="縦横比">
          {ASPECTS.map((key) => (
            <button
              key={key}
              type="button"
              className={key === aspect ? 'cr-aspectActive' : undefined}
              aria-pressed={key === aspect}
              onClick={() => changeAspect(key)}
            >
              {key}
              {tracks[key].length > 0 && <span className="cr-aspectCount">{tracks[key].length}</span>}
            </button>
          ))}
        </div>
        <label className="cr-fileButton">
          動画を選ぶ
          <input
            type="file"
            accept="video/*,.mkv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void loadFile(file)
              }
              event.target.value = ''
            }}
          />
        </label>
      </header>

      {notice && (
        <p className={`cr-notice cr-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} aria-label="閉じる">×</button>
        </p>
      )}
      {uploadProgress !== null && (
        <div className="cr-upload">
          <progress max={1} value={uploadProgress} />
          <span>アップロード中 {Math.round(uploadProgress * 100)}%（動画はもう操作できます）</span>
        </div>
      )}

      {!media ? (
        <div className="cr-dropZone">
          <p className="cr-dropTitle">ここに動画をドロップ</p>
          <p className="cr-note">mp4 / mov / webm / mkv。public/data のクリップ名（例: 2025-05-02-xxxx-005752-005812.mp4）ならキーフレームをクリップに保存できます。</p>
        </div>
      ) : (
        <>
          <main className="cr-stage">
            <section className="cr-sourcePane" aria-label="元映像">
              <SourceView
                videoRef={videoRef}
                src={media.url}
                source={source}
                aspect={aspect}
                rect={rect}
                center={frame}
                onEdit={handleEdit}
                onVideoEvent={handleVideoEvent}
              />
            </section>
            <section className="cr-outputPane" aria-label="完成形">
              <OutputPreview videoRef={videoRef} aspect={aspect} rect={rect} frameVersion={frameVersion} />
            </section>
          </main>
          <Timeline
            duration={video?.duration ?? 0}
            time={time}
            keyframes={keyframes}
            current={currentIndex}
            playing={playing}
            onSeek={seek}
            onMoveKeyframe={(index, t) => {
              if (video) {
                const next = moveKeyframe(keyframes, index, t, fps, video.duration)
                updateTrack(next)
                seek(next[index].t)
              }
            }}
            onTogglePlay={togglePlay}
            onStep={step}
            onJump={jump}
            onAdd={addKeyframe}
            onDelete={deleteKeyframe}
          />
          <div className="cr-panels">
            <KeyframeFields frame={frame} isKeyframe={currentIndex >= 0} fps={fps} onChange={handleFieldChange} />
            <ExportPanel
              sizes={EXPORT_SIZES[aspect]}
              size={size}
              onSize={setSize}
              scaler={scaler}
              onScaler={setScaler}
              sourceOptions={sourceOptions}
              source={chosenSource}
              onSource={setExportSource}
              blocked={blocked}
              job={job}
              resultUrl={resultUrl}
              onExport={() => void startExport()}
              onCancel={() => void cancelExport()}
              still={still}
              stillBusy={stillBusy}
              onStill={() => void renderStill()}
            />
            {clip && (
              <ClipPanel
                clip={clip}
                aspect={aspect}
                dirty={dirty}
                hasKeyframes={keyframes.length > 0}
                saving={saving}
                onSave={() => void saveToClip(keyframes)}
                onRemove={removeFromClip}
              />
            )}
          </div>
        </>
      )}
      {dragOver && <div className="cr-dropOverlay">ここにドロップして読み込む</div>}
    </div>
  )
}

function initialAspect(): CameraAspect {
  const value = new URLSearchParams(window.location.search).get('aspect')
  return ASPECTS.find((key) => key === value) ?? '9:16'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
