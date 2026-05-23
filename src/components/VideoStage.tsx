import type { RefObject } from 'react'
import type { FloatingStageClip } from '../voiceData'

type VideoStageProps = {
  floatingClips: FloatingStageClip[]
  stageRef: RefObject<HTMLDivElement | null>
  volume: number
  onClipEnded: (clipId: string) => void
}

export function VideoStage({ floatingClips, stageRef, volume, onClipEnded }: VideoStageProps) {
  return (
    <section className="video-stage-wrap" aria-live="polite">
      <div className="video-stage" ref={stageRef}>
        {floatingClips.length > 0 ? (
          floatingClips.map((stageClip, index) => (
            <article
              className="floating-clip"
              key={stageClip.id}
              style={{
                left: `${stageClip.left}px`,
                top: `${stageClip.top}px`,
                width: `${stageClip.width}px`,
                zIndex: index + 1,
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
          ))
        ) : (
          <p className="video-placeholder">カードを押すとここに動画がランダム表示されます</p>
        )}
      </div>
    </section>
  )
}