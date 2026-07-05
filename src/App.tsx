import { useCallback, useRef, useState } from 'react'
import './App.css'
import { AmbientLayer } from './components/AmbientLayer'
import { AnalyticsConsentBanner } from './components/AnalyticsConsentBanner'
import { AppGuide } from './components/AppGuide'
import { AppHeader } from './components/AppHeader'
import { CategoryToolbar } from './components/CategoryToolbar'
import { InfoModal } from './components/InfoModal'
import { ClipEditModal } from './components/dev/ClipEditModal'
import { PlaybackControls } from './components/PlaybackControls'
import { SortToolbar } from './components/SortToolbar'
import { ToastLayer } from './components/ToastLayer'
import { VoiceList } from './components/VoiceList'
import { VolumeDock } from './components/VolumeDock'
import { useAnalyticsConsent } from './hooks/useAnalyticsConsent'
import { useCategoryFilter } from './hooks/useCategoryFilter'
import { useClipCollection } from './hooks/useClipCollection'
import { useLocaleController } from './hooks/useLocaleController'
import { usePlayback } from './hooks/usePlayback'
import { usePlayCounts } from './hooks/usePlayCounts'
import { useVolume } from './hooks/useVolume'
import { LocaleProvider } from './i18n'
import { trackSortChange, trackYoutubeLinkClick } from './lib/analytics'
import {
  categoryCounts,
  categoryOptions,
  type SortType,
  type StreamGroup,
  type VoiceClip,
  type VoiceData,
} from './voiceData'

// npm run dev のときだけ有効なクリップ編集機能のフラグ。本番ビルドでは false に畳まれ、
// ClipEditModal を含む編集 UI は tree-shake で除去される。
const enableDevEditor = import.meta.env.DEV

function App() {
  const appShellRef = useRef<HTMLElement>(null)

  const { locale, isLocaleReady, changeLocale } = useLocaleController()
  const { totalPlays, playCounts } = usePlayCounts()
  const { shouldShowBanner, acceptConsent, declineConsent } = useAnalyticsConsent()
  const { selectedCategories, toggleCategory, selectAllCategories, clearAllCategories } = useCategoryFilter()

  const [sortType, setSortType] = useState<SortType>('reading')
  const { sortedClips, streamGroups, clipIndexMap, applyClipOverride } = useClipCollection({
    selectedCategories,
    sortType,
    playCounts,
  })
  const playback = usePlayback({ sortedClips, clipIndexMap, appShellRef })
  const { volume, setVolume } = useVolume(appShellRef, playback.floatingClips)

  const [infoClip, setInfoClip] = useState<VoiceClip | null>(null)
  const [editClip, setEditClip] = useState<VoiceClip | null>(null)

  const handleSortChange = useCallback((nextSortType: SortType) => {
    setSortType(nextSortType)
    trackSortChange(nextSortType)
  }, [])

  const handleInfoModalLinkClick = useCallback((linkType: 'clip' | 'source_video', clip: VoiceClip) => {
    const targetUrl = linkType === 'clip' ? clip.clipUrl : clip.videoFile.metadata.url
    trackYoutubeLinkClick(linkType, 'info_modal', targetUrl, clip.videoId)
  }, [])

  const handleStreamGroupLinkClick = useCallback((group: StreamGroup) => {
    trackYoutubeLinkClick('source_video', 'voice_group', group.url, group.key)
  }, [])

  // dev 編集の保存結果をローカル state へ反映（一覧・情報モーダルに即時反映）。
  const handleClipSaved = useCallback(
    (fileBaseName: string, updated: VoiceData) => {
      applyClipOverride(fileBaseName, updated)
      setInfoClip((current) =>
        current && current.fileBaseName === fileBaseName ? { ...current, ...updated } : current,
      )
    },
    [applyClipOverride],
  )

  return (
    <main className="app-shell" ref={appShellRef}>
      {!isLocaleReady ? (
        <p className="app-copy" aria-busy="true">
          {locale === 'en' ? 'Loading...' : '読み込み中…'}
        </p>
      ) : null}

      {isLocaleReady ? (
        <>
          <AmbientLayer />

          <AppHeader locale={locale} onChangeLocale={changeLocale} totalPlays={totalPlays} />

          <LocaleProvider value={locale}>
            <PlaybackControls
              sparkKey={playback.sparkKey}
              garageyaKey={playback.garageyaKey}
              isSequentialMode={playback.isSequentialMode}
              onPlayRandom={playback.playRandom}
              onPlayGarageya={playback.playGarageya}
              onStop={playback.stop}
              onToggleSequentialMode={playback.toggleSequential}
            />

            <ToastLayer
              floatingClips={playback.floatingClips}
              volume={volume}
              isStopping={playback.isStopping}
              onClipEnded={playback.handleSequentialEnded}
              onCloseClip={playback.handleToastClose}
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
              playCounts={playCounts}
              onPlayClip={playback.playClip}
              onOpenInfo={setInfoClip}
              onClickStreamGroupLink={handleStreamGroupLinkClick}
            />

            <AppGuide />

            {infoClip ? (
              <InfoModal
                clip={infoClip}
                onClose={() => setInfoClip(null)}
                onClickClipLink={handleInfoModalLinkClick}
                onClickSourceVideoLink={handleInfoModalLinkClick}
                onEdit={enableDevEditor ? setEditClip : undefined}
              />
            ) : null}

            {enableDevEditor && editClip ? (
              <ClipEditModal
                clip={editClip}
                categorySuggestions={categoryOptions}
                onClose={() => setEditClip(null)}
                onSaved={handleClipSaved}
              />
            ) : null}

            {shouldShowBanner ? (
              <AnalyticsConsentBanner onAccept={acceptConsent} onDecline={declineConsent} />
            ) : null}

            <VolumeDock volume={volume} onChangeVolume={setVolume} />
          </LocaleProvider>
        </>
      ) : null}
    </main>
  )
}

export default App
