import type { VoiceClip, SameSerifLabel, SortType, StreamGroup } from '../voiceData'
import { t } from '../i18n'
import { useLocale } from '../i18n'
import { ISSUE_ICONS, ISSUE_LABELS } from '../../scripts/dev-server/lib/clip-review.js'
import type { ClipReviewResult } from '../../scripts/dev-server/lib/clip-review.js'

type VoiceListProps = {
  sortType: SortType
  sortedClips: VoiceClip[]
  streamGroups: StreamGroup[]
  sameSerifLabels: Map<string, SameSerifLabel>
  playCounts: Record<string, number>
  // dev サーバのときだけ渡す。各クリップの要対応（未DL / 未カット / ルビ / 区切り）をカードのバッジに出す。
  reviews?: ReadonlyMap<string, ClipReviewResult>
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
  // dev サーバのときだけ渡す。未指定ならカードに編集ボタンを出さない。
  onOpenEdit?: (clip: VoiceClip) => void
  onClickStreamGroupLink: (group: StreamGroup) => void
}

function VoiceCard({
  clip,
  sameSerifLabel,
  playCount,
  review,
  onPlayClip,
  onOpenInfo,
  onOpenEdit,
}: {
  clip: VoiceClip
  sameSerifLabel?: SameSerifLabel
  playCount: number
  review?: ClipReviewResult
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
  onOpenEdit?: (clip: VoiceClip) => void
}) {
  const locale = useLocale()
  const sameSerifText = sameSerifLabel
    ? [sameSerifLabel.date, sameSerifLabel.no === undefined ? '' : t('voiceCard.sameSerifNo', { no: sameSerifLabel.no }, locale)]
        .filter(Boolean)
        .join(' ')
    : ''
  const subText = [sameSerifText, clip.categories.join(' / ')].filter(Boolean).join(' · ')
  const issues = review?.issues ?? []
  const isMissingVideo = issues.some((issue) => issue.kind === 'video')
  const cardClassName = [
    'voice-card',
    onOpenEdit ? 'has-edit' : '',
    isMissingVideo ? 'is-missing-video' : '',
  ].filter(Boolean).join(' ')

  return (
    <article className={cardClassName}>
      <button type="button" className="voice-card-play" onClick={() => onPlayClip(clip)}>
        <span className="voice-card-text">{clip.serif}</span>
        <span className="voice-card-sub">{subText}</span>
        {issues.length > 0 ? (
          // dev 限定。文言は要対応の規則（scripts/dev-server/lib/clip-review.js）から来る素の日本語。
          <span
            className="voice-card-review"
            aria-label={`要対応: ${issues.map((issue) => ISSUE_LABELS[issue.kind]).join('、')}`}
          >
            {issues.map((issue) => (
              <span className={`review-chip is-${issue.kind}`} key={issue.kind} title={issue.message}>
                <span aria-hidden="true">{ISSUE_ICONS[issue.kind]}</span> {ISSUE_LABELS[issue.kind]}
              </span>
            ))}
          </span>
        ) : null}
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
  sameSerifLabels,
  playCounts,
  reviews,
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
              sameSerifLabel={sameSerifLabels.get(clip.fileBaseName)}
              playCount={playCounts[clip.fileBaseName] ?? 0}
              review={reviews?.get(clip.fileBaseName)}
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
                  sameSerifLabel={sameSerifLabels.get(clip.fileBaseName)}
                  playCount={playCounts[clip.fileBaseName] ?? 0}
                  review={reviews?.get(clip.fileBaseName)}
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
