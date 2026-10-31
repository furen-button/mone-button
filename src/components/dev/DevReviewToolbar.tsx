import {
  ISSUE_ICONS,
  ISSUE_KINDS,
  ISSUE_LABELS,
} from '../../../scripts/dev-server/lib/clip-review.js'
import type { ClipIssueKind, ReviewSummary } from '../../../scripts/dev-server/lib/clip-review.js'

// dev 限定。並び替えの下に、要対応のクリップ数と種類ごとの件数を出し、種類で一覧を絞り込む。
// 件数はカテゴリで絞る前の全クリップで数える。絞り込み中はカテゴリの選択を無視して、その種類の
// 要対応をすべて見せる（カテゴリで隠れて数が合わないのを避ける）。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。

const KIND_TITLES: Record<ClipIssueKind, string> = {
  video: 'public/videos に mp4 が無い（npm run download で取得）',
  trim: 'trimming.original が無く、取り込み時の 30 秒の窓のまま',
  ruby: 'ruby にひらがな・長音・数字・英字以外の文字がある、または空',
  serif: 'serif に半角スペース無しで 15 字を超える区間がある',
}

type DevReviewToolbarProps = {
  summary: ReviewSummary
  totalClips: number
  videosLoaded: boolean
  filter: ReadonlySet<ClipIssueKind> | null
  onToggleKind: (kind: ClipIssueKind) => void
  onToggleAll: () => void
}

export function DevReviewToolbar({ summary, totalClips, videosLoaded, filter, onToggleKind, onToggleAll }: DevReviewToolbarProps) {
  const allActive = filter !== null && ISSUE_KINDS.every((kind) => filter.has(kind))

  let note = 'バッジの付いたカードが要対応です。種類を押すとその種類だけに絞り込みます。'
  if (filter) {
    note = '絞り込み中はカテゴリの選択を無視して、その種類の要対応をすべて表示します。'
  } else if (!videosLoaded) {
    note = '動画の有無を確認しています…'
  }

  return (
    <section className="dev-review-toolbar" aria-label="要対応クリップ（DEV）">
      <span className="dev-review-label">
        <span className="clip-edit-badge">DEV</span>
        要対応 {summary.total} / {totalClips} 件
      </span>
      <div className="dev-review-chips" role="group" aria-label="要対応の種類で絞り込む">
        <button
          type="button"
          className={`dev-review-chip is-all ${allActive ? 'is-active' : ''}`}
          aria-pressed={allActive}
          onClick={onToggleAll}
        >
          要対応のみ
        </button>
        {ISSUE_KINDS.map((kind) => {
          const active = filter?.has(kind) ?? false
          return (
            <button
              type="button"
              className={`dev-review-chip is-${kind} ${active ? 'is-active' : ''}`}
              key={kind}
              aria-pressed={active}
              title={KIND_TITLES[kind]}
              onClick={() => onToggleKind(kind)}
            >
              <span aria-hidden="true">{ISSUE_ICONS[kind]}</span> {ISSUE_LABELS[kind]}
              <span className="dev-review-count">{kind === 'video' && !videosLoaded ? '…' : summary.counts[kind]}</span>
            </button>
          )
        })}
      </div>
      <p className="dev-review-note">{note}</p>
    </section>
  )
}
