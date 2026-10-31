import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'
import { AmbientLayer } from './components/AmbientLayer'
import { AnalyticsConsentBanner } from './components/AnalyticsConsentBanner'
import { AppGuide } from './components/AppGuide'
import { AppHeader } from './components/AppHeader'
import { CategoryToolbar } from './components/CategoryToolbar'
import { InfoModal } from './components/InfoModal'
import { ClipEditModal } from './components/dev/ClipEditModal'
import { DevReviewToolbar } from './components/dev/DevReviewToolbar'
import { PlaybackControls } from './components/PlaybackControls'
import { SortToolbar } from './components/SortToolbar'
import { ToastLayer } from './components/ToastLayer'
import { VoiceList } from './components/VoiceList'
import { VolumeDock } from './components/VolumeDock'
import { useAnalyticsConsent } from './hooks/useAnalyticsConsent'
import { useCategoryFilter } from './hooks/useCategoryFilter'
import { useClipCollection } from './hooks/useClipCollection'
import { useDevVideoStatus } from './hooks/useDevVideoStatus'
import { useLocaleController } from './hooks/useLocaleController'
import { usePlayback } from './hooks/usePlayback'
import { usePlayCounts } from './hooks/usePlayCounts'
import { useVolume } from './hooks/useVolume'
import { LocaleProvider } from './i18n'
import { deleteClipData } from './lib/devDataEditor'
import { trackSortChange, trackYoutubeLinkClick } from './lib/analytics'
import { withVideoCacheBust } from './lib/videoPath'
import {
  categoryCounts,
  categoryOptions,
  withDisplaySerif,
  type SortType,
  type StreamGroup,
  type VoiceClip,
  type VoiceData,
} from './voiceData'
import { ISSUE_KINDS, summarizeReviews } from '../scripts/dev-server/lib/clip-review.js'
import type { ClipIssueKind } from '../scripts/dev-server/lib/clip-review.js'

// npm run dev のときだけ有効なクリップ編集機能のフラグ。本番ビルドでは false に畳まれ、
// ClipEditModal を含む編集 UI は tree-shake で除去される。
const enableDevEditor = import.meta.env.DEV

type ClipSavedOptions = {
  cacheBustVideo?: boolean
}

function App() {
  const appShellRef = useRef<HTMLElement>(null)

  const { locale, isLocaleReady, changeLocale } = useLocaleController()
  const { totalPlays, playCounts } = usePlayCounts()
  const { shouldShowBanner, acceptConsent, declineConsent } = useAnalyticsConsent()
  const { selectedCategories, toggleCategory, selectAllCategories, clearAllCategories } = useCategoryFilter()

  const [sortType, setSortType] = useState<SortType>('reading')
  const [videoVersions, setVideoVersions] = useState<Record<string, number>>({})

  // dev 限定: 要対応バッジの元になる mp4 の一覧と、種類での絞り込み。
  const { videos, refreshVideos } = useDevVideoStatus(enableDevEditor)
  const [issueFilter, setIssueFilter] = useState<ReadonlySet<ClipIssueKind> | null>(null)
  const reviewOptions = useMemo(
    () => (enableDevEditor ? { videos, filter: issueFilter } : undefined),
    [videos, issueFilter],
  )

  const {
    sortedClips,
    streamGroups,
    clipIndexMap,
    sameSerifLabels,
    reviews,
    totalClipCount,
    applyClipOverride,
    removeClip,
  } = useClipCollection({
    selectedCategories,
    sortType,
    playCounts,
    videoVersions,
    review: reviewOptions,
  })
  const reviewSummary = useMemo(() => (reviews ? summarizeReviews(reviews.values()) : undefined), [reviews])
  const playback = usePlayback({ sortedClips, clipIndexMap, appShellRef })
  const { volume, setVolume } = useVolume(appShellRef, playback.floatingClips)

  const [infoClip, setInfoClip] = useState<VoiceClip | null>(null)
  const [editClip, setEditClip] = useState<VoiceClip | null>(null)

  const handleSortChange = useCallback((nextSortType: SortType) => {
    setSortType(nextSortType)
    trackSortChange(nextSortType)
  }, [])

  const toggleIssueKind = useCallback((kind: ClipIssueKind) => {
    setIssueFilter((current) => {
      const next = new Set(current ?? [])
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        next.add(kind)
      }
      return next.size > 0 ? next : null
    })
  }, [])

  const toggleAllIssues = useCallback(() => {
    setIssueFilter((current) =>
      current && ISSUE_KINDS.every((kind) => current.has(kind)) ? null : new Set(ISSUE_KINDS),
    )
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
    (fileBaseName: string, updated: VoiceData, options?: ClipSavedOptions) => {
      const nextVideoVersion = options?.cacheBustVideo ? Date.now() : undefined
      if (nextVideoVersion) {
        setVideoVersions((current) => ({ ...current, [fileBaseName]: nextVideoVersion }))
      }
      applyClipOverride(fileBaseName, updated)
      setInfoClip((current) =>
        current && current.fileBaseName === fileBaseName
          ? {
              ...current,
              ...withDisplaySerif(updated),
              videoPath: withVideoCacheBust(current.videoPath, nextVideoVersion),
            }
          : current,
      )
      setEditClip((current) =>
        current && current.fileBaseName === fileBaseName
          ? {
              ...current,
              ...withDisplaySerif(updated),
              videoPath: withVideoCacheBust(current.videoPath, nextVideoVersion),
            }
          : current,
      )
    },
    [applyClipOverride],
  )

  const handleOpenEdit = useCallback(
    (clip: VoiceClip) => {
      setEditClip({
        ...clip,
        videoPath: withVideoCacheBust(clip.videoPath, videoVersions[clip.fileBaseName]),
      })
    },
    [videoVersions],
  )

  // 編集モーダルを閉じたら mp4 の一覧を取り直す（切り出しで mp4 が増えた・モーダルを開いたまま
  // npm run download した場合を拾う）。
  const handleCloseEdit = useCallback(() => {
    setEditClip(null)
    refreshVideos()
  }, [refreshVideos])

  // dev 限定: json と mp4 を trash/ へ退避し、一覧から外して情報モーダルを閉じる。
  // 失敗時は例外を InfoModal 側へ投げ返してエラー表示させる。
  const handleClipDelete = useCallback(
    async (clip: VoiceClip) => {
      await deleteClipData(clip.fileBaseName)
      removeClip(clip.fileBaseName)
      setInfoClip(null)
      refreshVideos()
    },
    [refreshVideos, removeClip],
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
              waiwaiKey={playback.waiwaiKey}
              isSequentialMode={playback.isSequentialMode}
              onPlayRandom={playback.playRandom}
              onPlayWaiwai={playback.playWaiwai}
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

            {enableDevEditor && reviews && reviewSummary ? (
              <DevReviewToolbar
                summary={reviewSummary}
                totalClips={totalClipCount}
                videosLoaded={videos !== undefined}
                filter={issueFilter}
                onToggleKind={toggleIssueKind}
                onToggleAll={toggleAllIssues}
              />
            ) : null}

            <VoiceList
              sortType={sortType}
              sortedClips={sortedClips}
              streamGroups={streamGroups}
              sameSerifLabels={sameSerifLabels}
              playCounts={playCounts}
              reviews={reviews}
              onPlayClip={playback.playClip}
              onOpenInfo={setInfoClip}
              onOpenEdit={enableDevEditor ? handleOpenEdit : undefined}
              onClickStreamGroupLink={handleStreamGroupLinkClick}
            />

            <AppGuide />

            {infoClip ? (
              <InfoModal
                clip={infoClip}
                onClose={() => setInfoClip(null)}
                onClickClipLink={handleInfoModalLinkClick}
                onClickSourceVideoLink={handleInfoModalLinkClick}
                onEdit={enableDevEditor ? handleOpenEdit : undefined}
                onDelete={enableDevEditor ? handleClipDelete : undefined}
              />
            ) : null}

            {enableDevEditor && editClip ? (
              <ClipEditModal
                clip={editClip}
                categorySuggestions={categoryOptions}
                hasVideo={videos ? videos.has(editClip.fileBaseName) : undefined}
                onClose={handleCloseEdit}
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
