import { useCallback, useEffect, useRef, useState } from 'react'
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
    return () => {
      exitTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer)
      })
      exitTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    setExitingClipIds((currentIds) => {
      const activeIds = new Set(floatingClips.map((clip) => clip.id))
      return currentIds.filter((id) => activeIds.has(id))
    })
  }, [floatingClips])

  if (floatingClips.length === 0) {
    return null
  }

  return (
    <section className="toast-layer" aria-live="polite" aria-label="Playback toast layer">
      {floatingClips.map((stageClip, index) => (
        <article
          className={`floating-clip ${isStopping ? 'is-stopping' : ''} ${exitingClipIds.includes(stageClip.id) ? 'is-exiting' : ''}`}
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