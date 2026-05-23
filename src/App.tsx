import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'

interface VoiceData {
  videoId: string
  serif: string
  ruby: string
  categories: string[]
  clipUrl: string
  memo: string
  trimming: {
    startTime: number
    endTime: number
    duration: number
  }
  videoFile: {
    metadata: {
      videoId: string
      title: string
      duration: number
      thumbnail: string
      uploader: string
      uploadDate: string
      viewCount: number
      url: string
    }
  }
}

interface VoiceClip extends VoiceData {
  fileBaseName: string
  videoPath: string
}

const dataModules = import.meta.glob<VoiceData>('../public/data/*.json', {
  eager: true,
  import: 'default',
})

const baseUrl = import.meta.env.BASE_URL

const voiceClips: VoiceClip[] = Object.entries(dataModules)
  .map(([path, data]) => {
    const filename = path.split('/').pop()
    if (!filename) {
      return null
    }

    const fileBaseName = filename.replace(/\.json$/i, '')
    return {
      ...data,
      fileBaseName,
      videoPath: `${baseUrl}videos/${fileBaseName}.mp4`,
    }
  })
  .filter((clip): clip is VoiceClip => clip !== null)

function App() {
  const [activeClip, setActiveClip] = useState<VoiceClip | null>(null)
  const [sparkKey, setSparkKey] = useState(0)
  const [position, setPosition] = useState({ left: 20, top: 20 })
  const stageRef = useRef<HTMLDivElement>(null)

  const sortedClips = useMemo(
    () => [...voiceClips].sort((a, b) => a.serif.localeCompare(b.serif, 'ja')),
    [],
  )

  const showClip = useCallback((nextClip: VoiceClip) => {
    const stage = stageRef.current

    const cardWidth = 320
    const cardHeight = 190
    const maxX = Math.max((stage?.clientWidth ?? 700) - cardWidth, 0)
    const maxY = Math.max((stage?.clientHeight ?? 380) - cardHeight, 0)

    setPosition({
      left: Math.random() * maxX,
      top: Math.random() * maxY,
    })
    setActiveClip(nextClip)
    setSparkKey((prev) => prev + 1)
  }, [])

  const playRandomClip = useCallback(() => {
    if (sortedClips.length === 0) {
      return
    }

    const randomIndex = Math.floor(Math.random() * sortedClips.length)
    showClip(sortedClips[randomIndex])
  }, [showClip, sortedClips])

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="app-kicker">Mone Button</p>
        <h1>ボイスカード</h1>
        <p className="app-copy">ボタンを押すと、ランダムな名言クリップを再生します。</p>
      </header>

      <section className="control-panel" aria-label="ボイス再生コントロール">
        <button type="button" className="voice-launch" onClick={playRandomClip}>
          <span className="voice-launch-icon" key={sparkKey} aria-hidden="true">
            ドドーン♪
          </span>
          ランダム再生
        </button>
      </section>

      <section className="video-stage-wrap" aria-live="polite">
        <div className="video-stage" ref={stageRef}>
          {activeClip ? (
            <article
              className="floating-clip"
              style={{ left: `${position.left}px`, top: `${position.top}px` }}
            >
              <video
                key={activeClip.fileBaseName}
                className="clip-video"
                src={activeClip.videoPath}
                controls
                autoPlay
              />
              <p className="clip-serif">{activeClip.serif}</p>
            </article>
          ) : (
            <p className="video-placeholder">カードを押すとここに動画がランダム表示されます</p>
          )}
        </div>
      </section>

      <section className="voice-grid" aria-label="ボイスカード一覧">
        {sortedClips.map((clip) => (
          <button
            type="button"
            className="voice-card"
            key={clip.fileBaseName}
            onClick={() => showClip(clip)}
          >
            <span className="voice-card-text">{clip.serif}</span>
            <span className="voice-card-sub">{clip.categories.join(' / ')}</span>
          </button>
        ))}
      </section>
    </main>
  )
}

export default App
