import { Fragment } from 'react'
import {
  MAX_RUN_UNITS,
  findLongSerifRuns,
  formatUnits,
  isSerifSeparator,
  runUnits,
  splitSerifTokens,
} from '../../../scripts/dev-server/lib/clip-review.js'

// dev 限定。serif の半角スペースと改行を見えるようにし、スペース無しで長く続く区間を強調する。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。
// 区間の数え方（絵文字・強調記法の除去、半角 0.5 字、1 行 15 字）は scripts/dev-server/lib/clip-review.js に
// あり、一覧の「区切り」バッジと同じ規則で数える。

type SerifSpacingPreviewProps = {
  serif: string
}

export function SerifSpacingPreview({ serif }: SerifSpacingPreviewProps) {
  if (!serif) {
    return null
  }

  const tokens = splitSerifTokens(serif)
  const longRuns = findLongSerifRuns(serif)

  return (
    <div className="clip-edit-serif-preview">
      <p className="clip-edit-serif-preview-text" aria-label="serif の区切りプレビュー">
        {tokens.map((token, index) => {
          if (token === ' ') {
            return (
              <span className="clip-edit-serif-space" key={index} title="半角スペース">
                ␣
              </span>
            )
          }
          if (isSerifSeparator(token)) {
            return (
              <Fragment key={index}>
                <span className="clip-edit-serif-newline" title="改行">↵</span>
                <br />
              </Fragment>
            )
          }
          if (!token) {
            return null
          }
          const units = runUnits(token)
          const isLong = units > MAX_RUN_UNITS
          // 全角スペースは折り返し位置にならないので、半角と見分けられるよう枠で示す。
          const parts = token.split(/(\u3000)/)
          return (
            <span
              className={isLong ? 'clip-edit-serif-run is-long' : 'clip-edit-serif-run'}
              key={index}
              title={isLong ? `${formatUnits(units)} 字（1 行 ${MAX_RUN_UNITS} 字を超えるため語の途中で折り返されます）` : undefined}
            >
              {parts.map((part, partIndex) =>
                part === '\u3000' ? (
                  <span className="clip-edit-serif-wide-space" key={partIndex} title="全角スペース（折り返し位置になりません）">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </span>
          )
        })}
      </p>
      {longRuns.length > 0 ? (
        <p className="clip-edit-serif-preview-note is-warn">
          ⚠ 半角スペース無しで {MAX_RUN_UNITS} 字を超える区間があります（
          {longRuns.map((run) => `${formatUnits(run.units)} 字`).join('・')}
          ）。動画では語の途中で折り返されます。
        </p>
      ) : (
        <p className="clip-edit-serif-preview-note">半角スペースの区切りは {MAX_RUN_UNITS} 字以内に収まっています。</p>
      )}
    </div>
  )
}
