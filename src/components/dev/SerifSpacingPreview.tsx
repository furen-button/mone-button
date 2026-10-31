import { Fragment } from 'react'
import {
  MAX_RUN_UNITS,
  countHalfwidthPunctuation,
  findLongSerifRuns,
  formatUnits,
  isSerifSeparator,
  runUnits,
  splitSerifTokens,
} from '../../../scripts/dev-server/lib/clip-review.js'

// dev 限定。serif の半角スペースと改行を見えるようにし、スペース無しで長く続く区間を強調する。
// 半角の ! ? も色を付けて示し、「全角にする」で ！ ？ に置き換えられるようにする。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。
// 区間の数え方（絵文字・強調記法の除去、半角 0.5 字、1 行 15 字）は scripts/dev-server/lib/clip-review.js に
// あり、一覧の「区切り」バッジと同じ規則で数える。

type SerifSpacingPreviewProps = {
  serif: string
  disabled?: boolean
  // 半角の ! ? を全角にする。指定が無ければボタンを出さない。
  onFullwidthPunctuation?: () => void
}

export function SerifSpacingPreview({ serif, disabled, onFullwidthPunctuation }: SerifSpacingPreviewProps) {
  if (!serif) {
    return null
  }

  const tokens = splitSerifTokens(serif)
  const longRuns = findLongSerifRuns(serif)
  // 置き換えは JSON の値に掛けるので、件数もプレビュー用の整形前の値で数える。
  const halfwidthCount = countHalfwidthPunctuation(serif)

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
          // 半角の ! ? は全角の文に混ざると細く詰まって見えるので色を付ける。
          const parts = token.split(/(\u3000|[!?])/)
          return (
            <span
              className={isLong ? 'clip-edit-serif-run is-long' : 'clip-edit-serif-run'}
              key={index}
              title={isLong ? `${formatUnits(units)} 字（1 行 ${MAX_RUN_UNITS} 字を超えるため語の途中で折り返されます）` : undefined}
            >
              {parts.map((part, partIndex) => {
                if (part === '\u3000') {
                  return (
                    <span className="clip-edit-serif-wide-space" key={partIndex} title="全角スペース（折り返し位置になりません）">
                      {part}
                    </span>
                  )
                }
                if (part === '!' || part === '?') {
                  return (
                    <span className="clip-edit-serif-halfwidth" key={partIndex} title={`半角の ${part}（「全角にする」で直せます）`}>
                      {part}
                    </span>
                  )
                }
                return part
              })}
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
      {halfwidthCount > 0 ? (
        <p className="clip-edit-serif-preview-note has-action">
          <span>
            半角の <span className="clip-edit-serif-halfwidth">!</span> <span className="clip-edit-serif-halfwidth">?</span> が {halfwidthCount} 個あります。
          </span>
          {onFullwidthPunctuation ? (
            <button type="button" className="clip-edit-generate" disabled={disabled} onClick={onFullwidthPunctuation}>
              ！？ 全角にする
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
