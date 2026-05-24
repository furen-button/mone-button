import type { FloatingStageClip } from '../voiceData'

type ToastLayerProps = {
  floatingClips: FloatingStageClip[]
  volume: number
  isStopping: boolean
  onClipEnded: (clipId: string) => void
}

export function ToastLayer({ floatingClips, volume, isStopping, onClipEnded }: ToastLayerProps) {
  if (floatingClips.length === 0) {
    return null
  }

  return (
    <section className="toast-layer" aria-live="polite" aria-label="Playback toast layer">
      {floatingClips.map((stageClip, index) => (
        <article
          className={`floating-clip ${isStopping ? 'is-stopping' : ''}`}
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
            onEnded={() => onClipEnded(stageClip.id)}
          />
          <p className="clip-serif">{stageClip.clip.serif}</p>
        </article>
      ))}
    </section>
  )
}