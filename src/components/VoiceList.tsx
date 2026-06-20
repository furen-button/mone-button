import type { VoiceClip, SortType, StreamGroup } from '../voiceData'
import { t } from '../i18n'
import { useLocale } from '../i18n'

type VoiceListProps = {
  sortType: SortType
  sortedClips: VoiceClip[]
  streamGroups: StreamGroup[]
  playCounts: Record<string, number>
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
  onClickStreamGroupLink: (group: StreamGroup) => void
}

function VoiceCard({
  clip,
  playCount,
  onPlayClip,
  onOpenInfo,
}: {
  clip: VoiceClip
  playCount: number
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
}) {
  const locale = useLocale()

  return (
    <article className="voice-card">
      <button type="button" className="voice-card-play" onClick={() => onPlayClip(clip)}>
        <span className="voice-card-text">{clip.serif}</span>
        <span className="voice-card-sub">{clip.categories.join(' / ')}</span>
      </button>
      <span className="voice-card-count" aria-label={t('voiceCard.playCountAria', { count: playCount }, locale)}>
        {t('voiceCard.playCount', { count: playCount.toLocaleString() }, locale)}
      </span>
      <button
        type="button"
        className="voice-card-info"
        aria-label={t('voiceCard.infoAria', {}, locale)}
        onClick={() => onOpenInfo(clip)}
      >
        i
      </button>
    </article>
  )
}

export function VoiceList({
  sortType,
  sortedClips,
  streamGroups,
  playCounts,
  onPlayClip,
  onOpenInfo,
  onClickStreamGroupLink,
}: VoiceListProps) {
  const locale = useLocale()

  if (sortType === 'reading' || sortType === 'play-count') {
    return (
      <section className="voice-grid" aria-label={t('voiceList.cardsAria', {}, locale)}>
        {sortedClips.length > 0 ? (
          sortedClips.map((clip) => (
            <VoiceCard
              key={clip.fileBaseName}
              clip={clip}
              playCount={playCounts[clip.fileBaseName] ?? 0}
              onPlayClip={onPlayClip}
              onOpenInfo={onOpenInfo}
            />
          ))
        ) : (
          <p className="empty-state">{t('voiceList.emptyClips', {}, locale)}</p>
        )}
      </section>
    )
  }

  return (
    <section className="stream-groups" aria-label={t('voiceList.streamGroupsAria', {}, locale)}>
      {streamGroups.length > 0 ? (
        streamGroups.map((group) => (
          <article className="stream-group" key={group.key}>
            <header className="stream-group-header">
              <a
                className="stream-group-link"
                href={group.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => onClickStreamGroupLink(group)}
              >
                {group.title}
              </a>
              <p className="stream-group-date">{t('streamGroup.dateLabel', {}, locale)}: {group.uploadDate}</p>
            </header>
            <div className="voice-grid">
              {group.clips.map((clip) => (
                <VoiceCard
                  key={clip.fileBaseName}
                  clip={clip}
                  playCount={playCounts[clip.fileBaseName] ?? 0}
                  onPlayClip={onPlayClip}
                  onOpenInfo={onOpenInfo}
                />
              ))}
            </div>
          </article>
        ))
      ) : (
        <p className="empty-state">{t('voiceList.emptyGroups', {}, locale)}</p>
      )}
    </section>
  )
}