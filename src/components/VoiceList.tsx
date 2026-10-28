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
  // dev サーバのときだけ渡す。未指定ならカードに編集ボタンを出さない。
  onOpenEdit?: (clip: VoiceClip) => void
  onClickStreamGroupLink: (group: StreamGroup) => void
}

function VoiceCard({
  clip,
  playCount,
  onPlayClip,
  onOpenInfo,
  onOpenEdit,
}: {
  clip: VoiceClip
  playCount: number
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
  onOpenEdit?: (clip: VoiceClip) => void
}) {
  const locale = useLocale()

  return (
    <article className={onOpenEdit ? 'voice-card has-edit' : 'voice-card'}>
      <button type="button" className="voice-card-play" onClick={() => onPlayClip(clip)}>
        <span className="voice-card-text">{clip.serif}</span>
        <span className="voice-card-sub">{clip.categories.join(' / ')}</span>
      </button>
      <span className="voice-card-count" aria-label={t('voiceCard.playCountAria', { count: playCount }, locale)}>
        {t('voiceCard.playCount', { count: playCount.toLocaleString() }, locale)}
      </span>
      {onOpenEdit ? (
        <button
          type="button"
          className="voice-card-edit"
          aria-label={t('voiceCard.editAria', {}, locale)}
          title={t('voiceCard.editAria', {}, locale)}
          onClick={() => onOpenEdit(clip)}
        >
          🔧
        </button>
      ) : null}
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
  onOpenEdit,
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
              onOpenEdit={onOpenEdit}
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
                  onOpenEdit={onOpenEdit}
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