import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { CategoryToolbar } from './components/CategoryToolbar'
import { InfoModal } from './components/InfoModal'
import { PlaybackControls } from './components/PlaybackControls'
import { SortToolbar } from './components/SortToolbar'
import { VideoStage } from './components/VideoStage'
import { VoiceList } from './components/VoiceList'
import { VolumeDock } from './components/VolumeDock'
import { LocaleProvider, localeOptions, t, type Locale } from './i18n'
import {
  GARAGEYA_PATTERNS,
  VOLUME_STORAGE_KEY,
  categoryCounts,
  categoryOptions,
  type FloatingStageClip,
  type GarageyaSlot,
  type PlaybackMode,
  type SortType,
  type StreamGroup,
  type VoiceClip,
  voiceClips,
} from './voiceData'

const LOCALE_STORAGE_KEY = 'mone-button-locale'

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)

    if (saved === 'ja' || saved === 'en') {
      return saved
    }

    return 'ja'
  })
  const [floatingClips, setFloatingClips] = useState<FloatingStageClip[]>([])
  const [isStopping, setIsStopping] = useState(false)
  const [sparkKey, setSparkKey] = useState(0)
  const [garageyaKey, setGarageyaKey] = useState(0)
  const [isSequentialMode, setIsSequentialMode] = useState(false)
  const [sequentialIndex, setSequentialIndex] = useState<number | null>(null)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('single')
  const [infoClip, setInfoClip] = useState<VoiceClip | null>(null)
  const [sortType, setSortType] = useState<SortType>('reading')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => categoryOptions)
  const [volume, setVolume] = useState<number>(() => {
    const saved = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (!saved) {
      return 0.7
    }

    const parsed = Number(saved)
    if (Number.isNaN(parsed)) {
      return 0.7
    }

    return Math.min(1, Math.max(0, parsed))
  })
  const stageRef = useRef<HTMLDivElement>(null)
  const stopTimerRef = useRef<number | null>(null)

  const petals = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => ({
        id: `petal-${index}`,
        left: `${(index * 11 + 7) % 100}%`,
        top: `${(index * 13 + 9) % 100}%`,
        size: `${12 + (index % 4) * 4}px`,
        delay: `${index * 0.8}s`,
        duration: `${10 + (index % 3) * 2}s`,
      })),
    [],
  )

  const sparkles = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) => ({
        id: `sparkle-${index}`,
        left: `${(index * 17 + 12) % 100}%`,
        top: `${(index * 19 + 8) % 100}%`,
        size: `${6 + (index % 3) * 3}px`,
        delay: `${index * 0.6}s`,
        duration: `${7 + (index % 4)}s`,
      })),
    [],
  )

  useEffect(() => {
    document.documentElement.lang = locale
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [locale])

  useEffect(() => {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
    const videos = stageRef.current?.querySelectorAll('video') ?? []
    videos.forEach((video) => {
      video.volume = volume
    })
  }, [volume, floatingClips])

  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current)
      }
    }
  }, [])

  const cancelStopAnimation = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }

    setIsStopping(false)
  }, [])

  const visibleClips = useMemo(
    () => voiceClips.filter((clip) => clip.categories.some((category) => selectedCategories.includes(category))),
    [selectedCategories],
  )

  const sortedClips = useMemo(
    () => {
      const clips = [...visibleClips]

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

        if (a.videoId !== b.videoId) {
          return a.videoId.localeCompare(b.videoId, 'ja')
        }

        const startTimeDiff = a.trimming.startTime - b.trimming.startTime
        if (startTimeDiff !== 0) {
          return startTimeDiff
        }

        return a.serif.localeCompare(b.serif, 'ja')
      })
    },
    [sortType, visibleClips],
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

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((current) => {
      if (current.includes(category)) {
        return current.filter((item) => item !== category)
      }

      return [...current, category].sort((a, b) => a.localeCompare(b, 'ja'))
    })
  }, [])

  const selectAllCategories = useCallback(() => {
    setSelectedCategories(categoryOptions)
  }, [categoryOptions])

  const clearAllCategories = useCallback(() => {
    setSelectedCategories([])
  }, [])

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

  const createGarageyaFloatingClip = useCallback(
    (nextClip: VoiceClip, slot: GarageyaSlot) => {
      const stage = stageRef.current
      const stageWidth = stage?.clientWidth ?? 700
      const stageHeight = stage?.clientHeight ?? 380

      const width = Math.round(stageWidth * slot.width)
      const height = Math.round(width * 0.6)
      const left = Math.min(Math.max(stageWidth * slot.x - width / 2, 0), Math.max(stageWidth - width, 0))
      const top = Math.min(Math.max(stageHeight * slot.y - height / 2, 0), Math.max(stageHeight - height, 0))

      return {
        id: `${nextClip.fileBaseName}-${Math.random().toString(36).slice(2, 8)}`,
        clip: nextClip,
        left,
        top,
        width,
      }
    },
    [],
  )

  const getRandomClip = useCallback(
    (excludeFileBaseName?: string) => {
      const candidates = excludeFileBaseName
        ? sortedClips.filter((clip) => clip.fileBaseName !== excludeFileBaseName)
        : sortedClips

      if (candidates.length === 0) {
        return null
      }

      return candidates[Math.floor(Math.random() * candidates.length)]
    },
    [sortedClips],
  )

  const playClipAtIndex = useCallback((index: number) => {
    if (sortedClips.length === 0) {
      return
    }

    cancelStopAnimation()

    const normalized = ((index % sortedClips.length) + sortedClips.length) % sortedClips.length
    const nextClip = sortedClips[normalized]

    setFloatingClips([createFloatingClip(nextClip, 320)])
    setSequentialIndex(normalized)
    setPlaybackMode('single')
    setSparkKey((prev) => prev + 1)
  }, [cancelStopAnimation, createFloatingClip, sortedClips])

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

    cancelStopAnimation()

    const pool = [...sortedClips]
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }

    const count = Math.min(4, pool.length)
    const pattern = GARAGEYA_PATTERNS[Math.floor(Math.random() * GARAGEYA_PATTERNS.length)]
    const nextFloating = pool.slice(0, count).map((clip, index) => {
      const slot = pattern[index % pattern.length]
      return createGarageyaFloatingClip(clip, slot)
    })

    setFloatingClips(nextFloating)
    setSequentialIndex(null)
    setPlaybackMode('garageya')
    setGarageyaKey((prev) => prev + 1)
  }, [cancelStopAnimation, createGarageyaFloatingClip, sortedClips])

  const handleSequentialEnded = useCallback((endedClipId?: string) => {
    if (!isSequentialMode || sortedClips.length === 0) {
      return
    }

    if (playbackMode === 'single') {
      if (sequentialIndex === null) {
        return
      }

      playClipAtIndex(sequentialIndex + 1)
      return
    }

    if (playbackMode === 'garageya') {
      setFloatingClips((currentClips) => {
        const endedClip = currentClips.find((clip) => clip.id === endedClipId) ?? currentClips[0]
        const remainingClips = endedClipId
          ? currentClips.filter((clip) => clip.id !== endedClipId)
          : currentClips.slice(1)
        const nextClip = getRandomClip(endedClip?.clip.fileBaseName)

        if (!nextClip) {
          return remainingClips
        }

        return [...remainingClips, createFloatingClip(nextClip, 320)]
      })
      return
    }
  }, [createFloatingClip, getRandomClip, isSequentialMode, playClipAtIndex, playbackMode, sequentialIndex, sortedClips.length])

  const stopPlayback = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
    }

    const videos = stageRef.current?.querySelectorAll('video') ?? []
    videos.forEach((video) => {
      video.pause()
      video.currentTime = 0
    })

    setIsSequentialMode(false)
    setSequentialIndex(null)
    setPlaybackMode('single')
    setIsStopping(true)

    stopTimerRef.current = window.setTimeout(() => {
      setFloatingClips([])
      setIsStopping(false)
      stopTimerRef.current = null
    }, 180)
  }, [])

  return (
    <main className="app-shell">
      <div className="ambient-layer" aria-hidden="true">
        {petals.map((petal) => (
          <span
            className="petal"
            key={petal.id}
            style={{
              left: petal.left,
              top: petal.top,
              width: petal.size,
              height: petal.size,
              animationDelay: petal.delay,
              animationDuration: petal.duration,
            }}
          />
        ))}
        {sparkles.map((sparkle) => (
          <span
            className="sparkle"
            key={sparkle.id}
            style={{
              left: sparkle.left,
              top: sparkle.top,
              width: sparkle.size,
              height: sparkle.size,
              animationDelay: sparkle.delay,
              animationDuration: sparkle.duration,
            }}
          />
        ))}
      </div>

      <header className="app-header">
        <div className="app-header-top">
          <p className="app-kicker">Mone Button</p>
          <div className="language-switch" role="group" aria-label={t('app.language.label', {}, locale)}>
            {localeOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`language-chip ${locale === option ? 'is-active' : ''}`}
                onClick={() => setLocale(option)}
                aria-pressed={locale === option}
              >
                {t(`app.language.${option}`, {}, locale)}
              </button>
            ))}
          </div>
        </div>
        <h1>{t('app.title', {}, locale)}</h1>
        <p className="app-copy">{t('app.copy', {}, locale)}</p>
      </header>

      <LocaleProvider value={locale}>
        <PlaybackControls
          sparkKey={sparkKey}
          garageyaKey={garageyaKey}
          isSequentialMode={isSequentialMode}
          onPlayRandom={playRandomClip}
          onPlayGarageya={playGarageya}
          onStop={stopPlayback}
          onToggleSequentialMode={() => setIsSequentialMode((prev) => !prev)}
        />

        <VideoStage
          floatingClips={floatingClips}
          stageRef={stageRef}
          volume={volume}
          isStopping={isStopping}
          onClipEnded={handleSequentialEnded}
        />

        <CategoryToolbar
          categoryOptions={categoryOptions}
          categoryCounts={categoryCounts}
          selectedCategories={selectedCategories}
          onSelectAll={selectAllCategories}
          onClearAll={clearAllCategories}
          onToggleCategory={toggleCategory}
        />

        <SortToolbar sortType={sortType} onChangeSortType={setSortType} />

        <VoiceList
          sortType={sortType}
          sortedClips={sortedClips}
          streamGroups={streamGroups}
          onPlayClip={showClip}
          onOpenInfo={setInfoClip}
        />

        {infoClip ? <InfoModal clip={infoClip} onClose={() => setInfoClip(null)} /> : null}

        <VolumeDock volume={volume} onChangeVolume={setVolume} />
      </LocaleProvider>
    </main>
  )
}

export default App
