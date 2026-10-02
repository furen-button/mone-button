import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t, useLocale } from '../i18n'
import type { FloatingStageClip } from '../voiceData'

const TOAST_EXIT_DURATION_MS = 180

type ToastLayerProps = {
  floatingClips: FloatingStageClip[]
  volume: number
  isStopping: boolean
  onClipEnded: (clipId: string) => void
  onCloseClip: (clipId: string) => void
}

export function ToastLayer({ floatingClips, volume, isStopping, onClipEnded, onCloseClip }: ToastLayerProps) {
  const locale = useLocale()
  const [exitingClipIds, setExitingClipIds] = useState<string[]>([])
  const exitTimersRef = useRef<Map<string, number>>(new Map())
  const activeExitingClipIds = useMemo(() => {
    const activeIds = new Set(floatingClips.map((clip) => clip.id))
    return new Set(exitingClipIds.filter((id) => activeIds.has(id)))
  }, [exitingClipIds, floatingClips])

  const startExit = useCallback((clipId: string, reason: 'ended' | 'close') => {
    setExitingClipIds((currentIds) => {
      if (currentIds.includes(clipId)) {
        return currentIds
      }

      const timer = window.setTimeout(() => {
        if (reason === 'ended') {
          onClipEnded(clipId)
        } else {
          onCloseClip(clipId)
        }

        setExitingClipIds((ids) => ids.filter((id) => id !== clipId))
        exitTimersRef.current.delete(clipId)
      }, TOAST_EXIT_DURATION_MS)

      exitTimersRef.current.set(clipId, timer)
      return [...currentIds, clipId]
    })
  }, [onClipEnded, onCloseClip])

  useEffect(() => {
    const exitTimers = exitTimersRef.current
    return () => {
      exitTimers.forEach((timer) => {
        window.clearTimeout(timer)
      })
      exitTimers.clear()
    }
  }, [])

  if (floatingClips.length === 0) {
    return null
  }

  return (
    <section className="toast-layer" aria-live="polite" aria-label="Playback toast layer">
      {floatingClips.map((stageClip, index) => (
        <article
          className={`floating-clip ${isStopping ? 'is-stopping' : ''} ${activeExitingClipIds.has(stageClip.id) ? 'is-exiting' : ''}`}
          key={stageClip.id}
          style={{
            left: `${stageClip.left}px`,
            top: `${stageClip.top}px`,
            width: `${stageClip.width}px`,
            zIndex: 120 + index,
          }}
        >
          <video
            key={stageClip.clip.fileBaseName}
            className="clip-video"
            src={stageClip.clip.videoPath}
            controls
            autoPlay
            ref={(video) => {
              if (video) {
                video.volume = volume
              }
            }}
            onEnded={() => startExit(stageClip.id, 'ended')}
          />
          <button
            type="button"
            className="floating-clip-close"
            aria-label={t('toast.close', {}, locale)}
            onClick={() => startExit(stageClip.id, 'close')}
          >
            ✗
          </button>
          <p className="clip-serif">{stageClip.clip.serif}</p>
        </article>
      ))}
    </section>
  )
}
