import { Fragment } from 'react'

// dev 限定。serif の半角スペースと改行を見えるようにし、スペース無しで長く続く区間を強調する。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。

// 動画のセリフは 1 行が埋まると直前の半角スペースで折り返す（scripts/create-video/ass.js の wrapText）。
// スペースの無い区間が 1 行より長いと語の途中で折れるので、1 行の字数を超えた区間を強調する。
// 字数は config-kirinuki のセリフ（1080p・既定の文字サイズ）で 15。ほかのプリセットは 18。
const MAX_RUN_UNITS = 15

// scripts/create-video/ass.js の charWidth と同じ規則（半角は 0.5 字）。
const charWidth = (ch: string): number => {
  const code = ch.codePointAt(0) ?? 0
  if (code <= 0x2ff) {
    return 0.5
  }
  if (code >= 0xff61 && code <= 0xff9f) {
    return 0.5
  }
  return 1
}

// 強調記法（{語} / {語|RRGGBB}）の記号は動画に出ないので数えない（ass.js の parseEmphasis と同じ規則）。
const runUnits = (run: string): number =>
  [...run.replace(/\{([^{}|]+)(?:\|[0-9A-Fa-f]{6})?\}/g, '$1')].reduce((sum, ch) => sum + charWidth(ch), 0)

const formatUnits = (units: number): string => (Number.isInteger(units) ? String(units) : units.toFixed(1))

type SerifSpacingPreviewProps = {
  serif: string
}

export function SerifSpacingPreview({ serif }: SerifSpacingPreviewProps) {
  if (!serif) {
    return null
  }

  const tokens = serif.split(/( |\r?\n)/)
  const longRuns = tokens.filter((token) => token !== ' ' && !/^\r?\n$/.test(token) && runUnits(token) > MAX_RUN_UNITS)

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
          if (/^\r?\n$/.test(token)) {
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
          {longRuns.map((run) => `${formatUnits(runUnits(run))} 字`).join('・')}
          ）。動画では語の途中で折り返されます。
        </p>
      ) : (
        <p className="clip-edit-serif-preview-note">半角スペースの区切りは {MAX_RUN_UNITS} 字以内に収まっています。</p>
      )}
    </div>
  )
}
