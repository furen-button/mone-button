import { stripEmphasisForDisplay } from './text'
import { ASPECTS } from './types'
import type { CameraAspect, ClipMatch } from './types'

type Props = {
  clip: ClipMatch
  aspect: CameraAspect
  dirty: boolean
  hasKeyframes: boolean
  saving: boolean
  onSave: () => void
  onRemove: () => void
}

// ドロップした動画が public/data のクリップと一致したときだけ出す。保存すると createVideo にも効く。
export function ClipPanel({ clip, aspect, dirty, hasKeyframes, saving, onSave, onRemove }: Props) {
  const saved = clip.camera[aspect]
  return (
    <section className="cr-panel" aria-label="クリップ">
      <h2>クリップ</h2>
      <p className="cr-clipSerif">{stripEmphasisForDisplay(clip.serif) || '（セリフなし）'}</p>
      <p className="cr-note cr-mono">{clip.base}</p>
      <ul className="cr-savedList">
        {ASPECTS.map((key) => (
          <li key={key} className={key === aspect ? 'cr-savedCurrent' : undefined}>
            {key}: {clip.camera[key]?.length ? `保存済み（${clip.camera[key]?.length} 件）` : '未保存'}
          </li>
        ))}
      </ul>
      {dirty && <p className="cr-dirty">{aspect} に未保存の変更があります</p>}
      <div className="cr-buttons">
        <button type="button" className="cr-primary" onClick={onSave} disabled={saving || !hasKeyframes || !dirty}>
          {saving ? '保存中…' : `クリップに保存（${aspect}）`}
        </button>
        <button type="button" onClick={onRemove} disabled={saving || !saved?.length}>この縦横比の設定を消す</button>
      </div>
      <p className="cr-note">保存すると createVideo の本番・still・QC がこの枠で切り出します（顔検出の reframe・自動 zoom より優先）。</p>
    </section>
  )
}
