import {
  ACKNOWLEDGEABLE_KINDS,
  ISSUE_ICONS,
  ISSUE_LABELS,
} from '../../../scripts/dev-server/lib/clip-review.js'
import type {
  AcknowledgeableIssueKind,
  ClipIssueKind,
  ClipReview,
  ClipReviewResult,
} from '../../../scripts/dev-server/lib/clip-review.js'

// dev 限定。編集モーダルの上部で、このクリップの要対応（未DL / 未カット / ルビ / 区切り）を
// 入力中の値から判定して並べ、trim / ruby / serif には「このままで良い」を記録できるようにする。
// 記録は review の state に入り、「保存」で JSON に書かれる（未保存のあいだは「保存で確定」と出す）。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。

type ClipReviewPanelProps = {
  result: ClipReviewResult
  review: ClipReview
  savedReview: ClipReview | undefined
  disabled?: boolean
  onAcknowledge: (kind: AcknowledgeableIssueKind) => void
  onRevoke: (kind: AcknowledgeableIssueKind) => void
}

const isAcknowledgeable = (kind: ClipIssueKind): kind is AcknowledgeableIssueKind =>
  (ACKNOWLEDGEABLE_KINDS as readonly ClipIssueKind[]).includes(kind)

export function ClipReviewPanel({ result, review, savedReview, disabled, onAcknowledge, onRevoke }: ClipReviewPanelProps) {
  if (result.issues.length === 0 && result.acknowledged.length === 0) {
    return (
      <p className="clip-edit-review is-ok" role="status">
        ✓ 要対応はありません
      </p>
    )
  }

  return (
    <section className="clip-edit-review" aria-label="要対応">
      <ul className="clip-edit-review-list">
        {result.issues.map((issue) => {
          // video は記録できない。クロージャに型の絞り込みを持ち込むため const に取る。
          const ackKind = isAcknowledgeable(issue.kind) ? issue.kind : null
          return (
            <li className={`clip-edit-review-item is-${issue.kind}`} key={issue.kind}>
              <span className={`review-chip is-${issue.kind}`}>
                <span aria-hidden="true">{ISSUE_ICONS[issue.kind]}</span> {ISSUE_LABELS[issue.kind]}
              </span>
              <span className="clip-edit-review-message">{issue.message}</span>
              {ackKind ? (
                <button
                  type="button"
                  className="clip-edit-review-ack"
                  disabled={disabled}
                  title="JSON の review に記録します。保存するとバッジが消え、値を変えると記録は外れます。"
                  onClick={() => onAcknowledge(ackKind)}
                >
                  このままで良い
                </button>
              ) : null}
            </li>
          )
        })}
        {result.acknowledged.map((kind) => {
          const pending = isAcknowledgeable(kind) && savedReview?.[kind] !== review[kind]
          return (
            <li className="clip-edit-review-item is-acked" key={kind}>
              <span className="review-chip is-acked">✓ {ISSUE_LABELS[kind]}</span>
              <span className="clip-edit-review-message">
                このままで良いと記録{pending ? '（保存で確定）' : '済み'}
              </span>
              {isAcknowledgeable(kind) ? (
                <button
                  type="button"
                  className="clip-edit-review-ack"
                  disabled={disabled}
                  onClick={() => onRevoke(kind)}
                >
                  取り消す
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
