import type { VoiceClip, SortType, StreamGroup } from '../voiceData'

type VoiceListProps = {
  sortType: SortType
  sortedClips: VoiceClip[]
  streamGroups: StreamGroup[]
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
}

function VoiceCard({
  clip,
  onPlayClip,
  onOpenInfo,
}: {
  clip: VoiceClip
  onPlayClip: (clip: VoiceClip) => void
  onOpenInfo: (clip: VoiceClip) => void
}) {
  return (
    <article className="voice-card">
      <button type="button" className="voice-card-play" onClick={() => onPlayClip(clip)}>
        <span className="voice-card-text">{clip.serif}</span>
        <span className="voice-card-sub">{clip.categories.join(' / ')}</span>
      </button>
      <button
        type="button"
        className="voice-card-info"
        aria-label="元動画情報を表示"
        onClick={() => onOpenInfo(clip)}
      >
        i
      </button>
    </article>
  )
}

export function VoiceList({ sortType, sortedClips, streamGroups, onPlayClip, onOpenInfo }: VoiceListProps) {
  if (sortType === 'reading') {
    return (
      <section className="voice-grid" aria-label="ボイスカード一覧">
        {sortedClips.length > 0 ? (
          sortedClips.map((clip) => (
            <VoiceCard key={clip.fileBaseName} clip={clip} onPlayClip={onPlayClip} onOpenInfo={onOpenInfo} />
          ))
        ) : (
          <p className="empty-state">選択中のカテゴリに該当するボイスがありません。</p>
        )}
      </section>
    )
  }

  return (
    <section className="stream-groups" aria-label="配信別ボイスカード一覧">
      {streamGroups.length > 0 ? (
        streamGroups.map((group) => (
          <article className="stream-group" key={group.key}>
            <header className="stream-group-header">
              <a className="stream-group-link" href={group.url} target="_blank" rel="noreferrer">
                {group.title}
              </a>
              <p className="stream-group-date">{group.uploadDate}</p>
            </header>
            <div className="voice-grid">
              {group.clips.map((clip) => (
                <VoiceCard key={clip.fileBaseName} clip={clip} onPlayClip={onPlayClip} onOpenInfo={onOpenInfo} />
              ))}
            </div>
          </article>
        ))
      ) : (
        <p className="empty-state">選択中のカテゴリに該当する配信がありません。</p>
      )}
    </section>
  )
}