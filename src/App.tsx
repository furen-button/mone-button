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

interface StreamGroup {
  key: string
  title: string
  uploadDate: string
  url: string
  clips: VoiceClip[]
}

interface FloatingStageClip {
  id: string
  clip: VoiceClip
  left: number
  top: number
  width: number
}

type SortType = 'reading' | 'stream-desc' | 'stream-asc'

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

const formatUploadDate = (uploadDate: string): string => {
  if (/^\d{8}$/.test(uploadDate)) {
    return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`
  }

  return uploadDate
}

function App() {
  const [floatingClips, setFloatingClips] = useState<FloatingStageClip[]>([])
  const [sparkKey, setSparkKey] = useState(0)
  const [garageyaKey, setGarageyaKey] = useState(0)
  const [isSequentialMode, setIsSequentialMode] = useState(false)
  const [sequentialIndex, setSequentialIndex] = useState<number | null>(null)
  const [infoClip, setInfoClip] = useState<VoiceClip | null>(null)
  const [sortType, setSortType] = useState<SortType>('reading')
  const stageRef = useRef<HTMLDivElement>(null)

  const sortedClips = useMemo(
    () => {
      const clips = [...voiceClips]

      if (sortType === 'reading') {
        return clips.sort((a, b) => a.ruby.localeCompare(b.ruby, 'ja'))
      }

      const direction = sortType === 'stream-desc' ? -1 : 1
      return clips.sort((a, b) => {
        const dateA = a.videoFile.metadata.uploadDate
        const dateB = b.videoFile.metadata.uploadDate

        if (dateA !== dateB) {
          return dateA > dateB ? direction : -direction
        }

        return a.serif.localeCompare(b.serif, 'ja')
      })
    },
    [sortType],
  )

  const streamGroups = useMemo(() => {
    if (sortType === 'reading') {
      return []
    }

    return sortedClips.reduce<StreamGroup[]>((groups, clip) => {
      const key = clip.videoId
      const lastGroup = groups[groups.length - 1]

      if (lastGroup && lastGroup.key === key) {
        lastGroup.clips.push(clip)
        return groups
      }

      groups.push({
        key,
        title: clip.videoFile.metadata.title,
        uploadDate: clip.videoFile.metadata.uploadDate,
        url: clip.videoFile.metadata.url,
        clips: [clip],
      })
      return groups
    }, [])
  }, [sortType, sortedClips])

  const clipIndexMap = useMemo(
    () => new Map(sortedClips.map((clip, index) => [clip.fileBaseName, index])),
    [sortedClips],
  )

  const createFloatingClip = useCallback((nextClip: VoiceClip, width: number) => {
    const stage = stageRef.current

    const cardHeight = Math.round(width * 0.6)
    const maxX = Math.max((stage?.clientWidth ?? 700) - width, 0)
    const maxY = Math.max((stage?.clientHeight ?? 380) - cardHeight, 0)

    return {
      id: `${nextClip.fileBaseName}-${Math.random().toString(36).slice(2, 8)}`,
      clip: nextClip,
      left: Math.random() * maxX,
      top: Math.random() * maxY,
      width,
    }
  }, [])

  const playClipAtIndex = useCallback((index: number) => {
    if (sortedClips.length === 0) {
      return
    }

    const normalized = ((index % sortedClips.length) + sortedClips.length) % sortedClips.length
    const nextClip = sortedClips[normalized]

    setFloatingClips([createFloatingClip(nextClip, 320)])
    setSequentialIndex(normalized)
    setSparkKey((prev) => prev + 1)
  }, [createFloatingClip, sortedClips])

  const showClip = useCallback((nextClip: VoiceClip) => {
    const index = clipIndexMap.get(nextClip.fileBaseName) ?? 0
    playClipAtIndex(index)
  }, [clipIndexMap, playClipAtIndex])

  const playRandomClip = useCallback(() => {
    if (sortedClips.length === 0) {
      return
    }

    const randomIndex = Math.floor(Math.random() * sortedClips.length)
    playClipAtIndex(randomIndex)
  }, [playClipAtIndex, sortedClips])

  const playGarageya = useCallback(() => {
    if (sortedClips.length === 0) {
      return
    }

    const pool = [...sortedClips]
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }

    const count = Math.min(4, pool.length)
    const nextFloating = pool
      .slice(0, count)
      .map((clip, index) => createFloatingClip(clip, 230 + index * 16))

    setFloatingClips(nextFloating)
    setSequentialIndex(null)
    setGarageyaKey((prev) => prev + 1)
  }, [createFloatingClip, sortedClips])

  const handleSequentialEnded = useCallback(() => {
    if (!isSequentialMode || sequentialIndex === null || sortedClips.length === 0) {
      return
    }

    playClipAtIndex(sequentialIndex + 1)
  }, [isSequentialMode, playClipAtIndex, sequentialIndex, sortedClips.length])

  const renderVoiceCard = useCallback(
    (clip: VoiceClip) => (
      <article className="voice-card" key={clip.fileBaseName}>
        <button type="button" className="voice-card-play" onClick={() => showClip(clip)}>
          <span className="voice-card-text">{clip.serif}</span>
          <span className="voice-card-sub">{clip.categories.join(' / ')}</span>
        </button>
        <button
          type="button"
          className="voice-card-info"
          aria-label="元動画情報を表示"
          onClick={(event) => {
            event.stopPropagation()
            setInfoClip(clip)
          }}
        >
          i
        </button>
      </article>
    ),
    [showClip],
  )

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
        <button type="button" className="voice-garageya" onClick={playGarageya}>
          <span className="voice-launch-icon" key={garageyaKey} aria-hidden="true">
            わいわい
          </span>
          ガヤガヤ再生
        </button>
        <button
          type="button"
          className={`voice-sequential ${isSequentialMode ? 'is-active' : ''}`}
          aria-pressed={isSequentialMode}
          onClick={() => setIsSequentialMode((prev) => !prev)}
        >
          ⇄ 連続再生 {isSequentialMode ? 'ON' : 'OFF'}
        </button>
        <div className="sort-controls" role="group" aria-label="ソートコントロール">
          <button
            type="button"
            className={`sort-chip ${sortType === 'reading' ? 'is-active' : ''}`}
            onClick={() => setSortType('reading')}
            aria-pressed={sortType === 'reading'}
          >
            あ 読み順
          </button>
          <button
            type="button"
            className={`sort-chip ${sortType === 'stream-desc' ? 'is-active' : ''}`}
            onClick={() => setSortType('stream-desc')}
            aria-pressed={sortType === 'stream-desc'}
          >
            ↓ 配信日(新しい順)
          </button>
          <button
            type="button"
            className={`sort-chip ${sortType === 'stream-asc' ? 'is-active' : ''}`}
            onClick={() => setSortType('stream-asc')}
            aria-pressed={sortType === 'stream-asc'}
          >
            ↑ 配信日(古い順)
          </button>
        </div>
      </section>

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
                  onEnded={
                    floatingClips.length === 1 && index === 0 ? handleSequentialEnded : undefined
                  }
                />
                <p className="clip-serif">{stageClip.clip.serif}</p>
              </article>
            ))
          ) : (
            <p className="video-placeholder">カードを押すとここに動画がランダム表示されます</p>
          )}
        </div>
      </section>

      {sortType === 'reading' ? (
        <section className="voice-grid" aria-label="ボイスカード一覧">
          {sortedClips.map((clip) => renderVoiceCard(clip))}
        </section>
      ) : (
        <section className="stream-groups" aria-label="配信別ボイスカード一覧">
          {streamGroups.map((group) => (
            <article className="stream-group" key={group.key}>
              <header className="stream-group-header">
                <a
                  className="stream-group-link"
                  href={group.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {group.title}
                </a>
                <p className="stream-group-date">{formatUploadDate(group.uploadDate)}</p>
              </header>
              <div className="voice-grid">
                {group.clips.map((clip) => renderVoiceCard(clip))}
              </div>
            </article>
          ))}
        </section>
      )}

      {infoClip ? (
        <div
          className="info-modal-backdrop"
          role="presentation"
          onClick={() => setInfoClip(null)}
        >
          <section
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-label="元動画情報"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="info-modal-title">元動画情報</h2>
            <p className="info-modal-video-title">{infoClip.videoFile.metadata.title}</p>
            <p className="info-modal-date">
              配信日: {formatUploadDate(infoClip.videoFile.metadata.uploadDate)}
            </p>
            <dl className="info-modal-meta">
              <div className="info-modal-row">
                <dt>セリフ</dt>
                <dd>{infoClip.serif}</dd>
              </div>
              <div className="info-modal-row">
                <dt>ルビ</dt>
                <dd>{infoClip.ruby}</dd>
              </div>
              <div className="info-modal-row">
                <dt>カテゴリー</dt>
                <dd>{infoClip.categories.join(' / ')}</dd>
              </div>
            </dl>
            <a
              className="info-modal-link"
              href={infoClip.clipUrl}
              target="_blank"
              rel="noreferrer"
            >
              このボイスの開始位置を開く
            </a>
            <a
              className="info-modal-link"
              href={infoClip.videoFile.metadata.url}
              target="_blank"
              rel="noreferrer"
            >
              元動画ページを開く
            </a>
            <button type="button" className="info-modal-close" onClick={() => setInfoClip(null)}>
              閉じる
            </button>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
