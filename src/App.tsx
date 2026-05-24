import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AnalyticsConsentBanner } from './components/AnalyticsConsentBanner'
import { CategoryToolbar } from './components/CategoryToolbar'
import { InfoModal } from './components/InfoModal'
import { PlaybackControls } from './components/PlaybackControls'
import { SortToolbar } from './components/SortToolbar'
import { ToastLayer } from './components/ToastLayer'
import { VoiceList } from './components/VoiceList'
import { VolumeDock } from './components/VolumeDock'
import { LocaleProvider, loadLocale, localeOptions, t, type Locale } from './i18n'
import {
  getAnalyticsConsent,
  isAnalyticsConfigured,
  initializeAnalytics,
  setAnalyticsConsent,
  trackCategoryToggle,
  trackPageView,
  trackPlaybackStart,
  trackSequentialAdvance,
  trackSequentialToggle,
  trackSortChange,
  trackYoutubeLinkClick,
  type AnalyticsConsent,
  type PlaybackStartSource,
} from './lib/analytics'
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
  const [isLocaleReady, setIsLocaleReady] = useState(false)
  const [floatingClips, setFloatingClips] = useState<FloatingStageClip[]>([])
  const [isStopping, setIsStopping] = useState(false)
  const [sparkKey, setSparkKey] = useState(0)
  const [garageyaKey, setGarageyaKey] = useState(0)
  const [isSequentialMode, setIsSequentialMode] = useState(false)
  const [sequentialIndex, setSequentialIndex] = useState<number | null>(null)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('single')
  const [infoClip, setInfoClip] = useState<VoiceClip | null>(null)
  const [sortType, setSortType] = useState<SortType>('reading')
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsent>(() => getAnalyticsConsent())
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
  const appShellRef = useRef<HTMLElement>(null)
  const stopTimerRef = useRef<number | null>(null)
  const localeChangeRequestRef = useRef(0)
  const pageViewSentRef = useRef(false)
  const shouldShowAnalyticsConsentBanner = isAnalyticsConfigured() && analyticsConsent === 'unknown'

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
    let isActive = true

    void loadLocale(locale)
      .then(() => {
        if (isActive) {
          setIsLocaleReady(true)
        }
      })
      .catch(() => {
        if (isActive) {
          setIsLocaleReady(true)
        }
      })

    return () => {
      isActive = false
    }
  }, [locale])

  useEffect(() => {
    if (!isLocaleReady) {
      return
    }

    document.documentElement.lang = locale
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [isLocaleReady, locale])

  useEffect(() => {
    if (!isLocaleReady) {
      return
    }

    document.title = t('app.title', {}, locale)
  }, [isLocaleReady, locale])

  useEffect(() => {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
    const videos = appShellRef.current?.querySelectorAll('video') ?? []
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

  useEffect(() => {
    if (analyticsConsent !== 'granted') {
      return
    }

    const initialized = initializeAnalytics()
    if (!initialized || pageViewSentRef.current) {
      return
    }

    trackPageView(`${window.location.pathname}${window.location.search}`)
    pageViewSentRef.current = true
  }, [analyticsConsent])

  const cancelStopAnimation = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }

    setIsStopping(false)
  }, [])

  const handleLocaleChange = useCallback(
    async (nextLocale: Locale) => {
      if (nextLocale === locale) {
        return
      }

      const requestId = ++localeChangeRequestRef.current
      await loadLocale(nextLocale)

      if (localeChangeRequestRef.current !== requestId) {
        return
      }

      setLocale(nextLocale)
    },
    [locale],
  )

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
        trackCategoryToggle(category, false)
        return current.filter((item) => item !== category)
      }

      trackCategoryToggle(category, true)
      return [...current, category].sort((a, b) => a.localeCompare(b, 'ja'))
    })
  }, [])

  const selectAllCategories = useCallback(() => {
    setSelectedCategories(categoryOptions)
  }, [])

  const clearAllCategories = useCallback(() => {
    setSelectedCategories([])
  }, [])

  const createFloatingClip = useCallback((nextClip: VoiceClip, width: number) => {
    const shellWidth = appShellRef.current?.clientWidth ?? Math.min(window.innerWidth, 700)
    const viewportHeight = window.innerHeight
    const safeSidePadding = 20
    const safeTopPadding = 84
    const safeBottomPadding = 140
    const clampedWidth = Math.min(width, Math.max(shellWidth - safeSidePadding * 2, 220))

    const cardHeight = Math.round(clampedWidth * 0.6)
    const maxX = Math.max(shellWidth - clampedWidth - safeSidePadding * 2, 0)
    const maxY = Math.max(viewportHeight - cardHeight - safeTopPadding - safeBottomPadding, 0)

    return {
      id: `${nextClip.fileBaseName}-${Math.random().toString(36).slice(2, 8)}`,
      clip: nextClip,
      left: safeSidePadding + Math.random() * maxX,
      top: safeTopPadding + Math.random() * maxY,
      width: clampedWidth,
    }
  }, [])

  const createGarageyaFloatingClip = useCallback(
    (nextClip: VoiceClip, slot: GarageyaSlot) => {
      const stageWidth = appShellRef.current?.clientWidth ?? Math.min(window.innerWidth, 700)
      const stageHeight = Math.max(window.innerHeight - 240, 320)
      const safeSidePadding = 20
      const safeTopPadding = 84

      const width = Math.round((stageWidth - safeSidePadding * 2) * slot.width)
      const height = Math.round(width * 0.6)
      const left = Math.min(
        Math.max((stageWidth - safeSidePadding * 2) * slot.x - width / 2 + safeSidePadding, safeSidePadding),
        Math.max(stageWidth - width - safeSidePadding, safeSidePadding),
      )
      const top = Math.min(
        Math.max(stageHeight * slot.y - height / 2 + safeTopPadding, safeTopPadding),
        Math.max(stageHeight - height + safeTopPadding, safeTopPadding),
      )

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

  const playClipAtIndex = useCallback((index: number, sourceAction: PlaybackStartSource = 'voice_card') => {
    if (sortedClips.length === 0) {
      return
    }

    cancelStopAnimation()

    const normalized = ((index % sortedClips.length) + sortedClips.length) % sortedClips.length
    const nextClip = sortedClips[normalized]

    trackPlaybackStart(nextClip, 'single', sourceAction)
    setFloatingClips((current) => [...current, createFloatingClip(nextClip, 320)])
    setSequentialIndex(normalized)
    setPlaybackMode('single')
    setSparkKey((prev) => prev + 1)
  }, [cancelStopAnimation, createFloatingClip, sortedClips])

  const showClip = useCallback((nextClip: VoiceClip) => {
    const index = clipIndexMap.get(nextClip.fileBaseName) ?? 0
    playClipAtIndex(index, 'voice_card')
  }, [clipIndexMap, playClipAtIndex])

  const playRandomClip = useCallback(() => {
    if (sortedClips.length === 0) {
      return
    }

    const randomIndex = Math.floor(Math.random() * sortedClips.length)
    playClipAtIndex(randomIndex, 'random_button')
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

    nextFloating.forEach((stageClip) => {
      trackPlaybackStart(stageClip.clip, 'garageya', 'garageya_button')
    })

    setFloatingClips(nextFloating)
    setSequentialIndex(null)
    setPlaybackMode('garageya')
    setGarageyaKey((prev) => prev + 1)
  }, [cancelStopAnimation, createGarageyaFloatingClip, sortedClips])

  const handleSequentialEnded = useCallback((endedClipId?: string) => {
    if (endedClipId) {
      setFloatingClips((currentClips) => currentClips.filter((clip) => clip.id !== endedClipId))
    }

    if (!isSequentialMode || sortedClips.length === 0) {
      return
    }

    if (playbackMode === 'single') {
      if (sequentialIndex === null) {
        return
      }

      const nextIndex = sequentialIndex + 1
      const normalized = ((nextIndex % sortedClips.length) + sortedClips.length) % sortedClips.length
      const fromClip = sortedClips[sequentialIndex]
      const toClip = sortedClips[normalized]
      if (fromClip && toClip) {
        trackSequentialAdvance('single', fromClip.fileBaseName, toClip.fileBaseName)
      }

      playClipAtIndex(nextIndex, 'sequential_single')
      return
    }

    if (playbackMode === 'garageya') {
      setFloatingClips((currentClips) => {
        const endedClip = currentClips.find((clip) => clip.id === endedClipId)
        const remainingClips = endedClipId ? currentClips.filter((clip) => clip.id !== endedClipId) : currentClips
        const nextClip = getRandomClip(endedClip?.clip.fileBaseName)

        if (!nextClip) {
          return remainingClips
        }

        trackSequentialAdvance('garageya', endedClip?.clip.fileBaseName ?? '', nextClip.fileBaseName)
        trackPlaybackStart(nextClip, 'garageya', 'sequential_garageya')

        return [...remainingClips, createFloatingClip(nextClip, 320)]
      })
      return
    }
  }, [createFloatingClip, getRandomClip, isSequentialMode, playClipAtIndex, playbackMode, sequentialIndex, sortedClips])

  const handleToastClose = useCallback((clipId: string) => {
    setFloatingClips((currentClips) => currentClips.filter((clip) => clip.id !== clipId))
  }, [])

  const stopPlayback = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
    }

    const videos = appShellRef.current?.querySelectorAll('video') ?? []
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

  const handleToggleSequentialMode = useCallback(() => {
    setIsSequentialMode((prev) => {
      const nextValue = !prev
      trackSequentialToggle(nextValue, playbackMode)
      return nextValue
    })
  }, [playbackMode])

  const handleSortChange = useCallback((nextSortType: SortType) => {
    setSortType(nextSortType)
    trackSortChange(nextSortType)
  }, [])

  const handleConsentAccept = useCallback(() => {
    setAnalyticsConsent(true)
    setAnalyticsConsentState('granted')
  }, [])

  const handleConsentDecline = useCallback(() => {
    setAnalyticsConsent(false)
    setAnalyticsConsentState('denied')
  }, [])

  const handleInfoModalLinkClick = useCallback((linkType: 'clip' | 'source_video', clip: VoiceClip) => {
    const targetUrl = linkType === 'clip' ? clip.clipUrl : clip.videoFile.metadata.url
    trackYoutubeLinkClick(linkType, 'info_modal', targetUrl, clip.videoId)
  }, [])

  const handleStreamGroupLinkClick = useCallback((group: StreamGroup) => {
    trackYoutubeLinkClick('source_video', 'voice_group', group.url, group.key)
  }, [])

  const handleGuideChannelClick = useCallback(() => {
    trackYoutubeLinkClick('channel', 'app_guide', 'https://www.youtube.com/@KozueMone')
  }, [])

  return (
    <main className="app-shell" ref={appShellRef}>
      {!isLocaleReady ? (
        <p className="app-copy" aria-busy="true">
          {locale === 'en' ? 'Loading...' : '読み込み中…'}
        </p>
      ) : null}

      {isLocaleReady ? (
        <>
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
          <p className="app-kicker">{t('app.siteName', {}, locale)}</p>
          <div className="language-switch" role="group" aria-label={t('app.language.label', {}, locale)}>
            {localeOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`language-chip ${locale === option ? 'is-active' : ''}`}
                onClick={() => {
                  void handleLocaleChange(option)
                }}
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
          onToggleSequentialMode={handleToggleSequentialMode}
        />

        <ToastLayer
          floatingClips={floatingClips}
          volume={volume}
          isStopping={isStopping}
          onClipEnded={handleSequentialEnded}
          onCloseClip={handleToastClose}
        />

        <CategoryToolbar
          categoryOptions={categoryOptions}
          categoryCounts={categoryCounts}
          selectedCategories={selectedCategories}
          onSelectAll={selectAllCategories}
          onClearAll={clearAllCategories}
          onToggleCategory={toggleCategory}
        />

        <SortToolbar sortType={sortType} onChangeSortType={handleSortChange} />

        <VoiceList
          sortType={sortType}
          sortedClips={sortedClips}
          streamGroups={streamGroups}
          onPlayClip={showClip}
          onOpenInfo={setInfoClip}
          onClickStreamGroupLink={handleStreamGroupLinkClick}
        />

        <section className="app-guide" aria-label={t('app.guide.section', {}, locale)}>
          <p className="app-guide-line">
            <a
              className="app-guide-link"
              href="https://www.youtube.com/@KozueMone"
              target="_blank"
              rel="noreferrer"
              onClick={handleGuideChannelClick}
            >
              {t('app.guide.channel', {}, locale)}
            </a>
          </p>
          <p className="app-guide-line">{t('app.guide.infoHint', {}, locale)}</p>
          <p className="app-guide-line">
            {t('app.guide.homageLead', {}, locale)}
            <a
              className="app-guide-link"
              href="http://ushiumi.ichiya-boshi.net"
              target="_blank"
              rel="noreferrer"
            >
              {t('app.guide.ushiumiButton', {}, locale)}
            </a>
            {t('app.guide.homageMiddle', {}, locale)}
            <a
              className="app-guide-link"
              href="https://wikiwiki.jp/nijisanji/%E2%97%8B%E2%97%8B%E3%83%9C%E3%82%BF%E3%83%B3"
              target="_blank"
              rel="noreferrer"
            >
              {t('app.guide.variousButtons', {}, locale)}
            </a>
            {t('app.guide.homageTrail', {}, locale)}
          </p>
          <p className="app-guide-line">
            <a
              className="app-guide-link"
              href="https://www.anycolor.co.jp/guidelines/"
              target="_blank"
              rel="noreferrer"
            >
              {t('app.guide.anycolorGuideline', {}, locale)}
            </a>
            {t('app.guide.guidelineNote', {}, locale)}
          </p>
          <p className="app-guide-line">
            {t('app.guide.relatedLead', {}, locale)}
            <a className="app-guide-link" href="https://www.youtube.com/@master-j-abc" target="_blank" rel="noreferrer">
              YouTube
            </a>
            ,{' '}
            <a className="app-guide-link" href="https://twitter.com/hero_master_j" target="_blank" rel="noreferrer">
              Twitter(X)
            </a>
            {t('app.guide.relatedTrail', {}, locale)}
          </p>
        </section>

        {infoClip ? (
          <InfoModal
            clip={infoClip}
            onClose={() => setInfoClip(null)}
            onClickClipLink={handleInfoModalLinkClick}
            onClickSourceVideoLink={handleInfoModalLinkClick}
          />
        ) : null}

        {shouldShowAnalyticsConsentBanner ? (
          <AnalyticsConsentBanner onAccept={handleConsentAccept} onDecline={handleConsentDecline} />
        ) : null}

        <VolumeDock volume={volume} onChangeVolume={setVolume} />
      </LocaleProvider>
          </>
        ) : null}
    </main>
  )
}

export default App
