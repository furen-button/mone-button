import { useState } from 'react'
import type { FormEvent } from 'react'
import { EditorApiError, savePreset } from '../api'
import type { Patch, PresetFile, PresetSummary } from '../types'

type NewPresetDialogProps = {
  presets: PresetSummary[]
  currentName: string
  pendingPatch: Patch
  dirty: number
  onCreated(preset: PresetFile): void
  onClose(): void
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/u
const EMPTY_PATCH: Patch = { set: [], unset: [] }

// 新しいプリセット config-<name>.json を作る。空 {} は全項目が DEFAULTS を継承する正当なプリセット。
export function NewPresetDialog({ presets, currentName, pendingPatch, dirty, onCreated, onClose }: NewPresetDialogProps) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'empty' | 'copy'>('empty')
  const [base, setBase] = useState(currentName || presets[0]?.name || '')
  const [inherit, setInherit] = useState(dirty > 0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const valid = NAME_PATTERN.test(name)
  const fileName = `config-${name}.json`
  const exists = presets.some((preset) => preset.name === fileName)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || saving) {
      return
    }
    setSaving(true)
    setError('')
    try {
      const created = await savePreset({
        mode: 'create',
        name: fileName,
        base: template === 'copy' ? base : null,
        patch: inherit ? pendingPatch : EMPTY_PATCH,
      })
      onCreated(created)
    } catch (cause) {
      if (cause instanceof EditorApiError && cause.status === 409) {
        setError('同名のファイルが既にあります')
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cv-dialogBackdrop" role="presentation" onClick={onClose}>
      <form
        className="cv-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新しいプリセットを作成"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
          }
        }}
      >
        <h2>新しいプリセットを作成</h2>
        <label className="cv-fieldStack">
          <span className="cv-controlLabel">ファイル名</span>
          <span className="cv-nameInput">
            <span>config-</span>
            <input className="cv-input" type="text" value={name} autoFocus onChange={(event) => setName(event.target.value.trim())} placeholder="matome-02" />
            <span>.json</span>
          </span>
          <span className="cv-hint">
            → scripts/create-video/{valid ? fileName : 'config-….json'}
            {name && !valid ? '（英小文字・数字・ハイフン、41 文字まで）' : ''}
          </span>
        </label>
        <fieldset className="cv-fieldStack">
          <legend className="cv-controlLabel">テンプレート</legend>
          <label className="cv-toggle">
            <input type="radio" name="template" checked={template === 'empty'} onChange={() => setTemplate('empty')} />
            <span>空（{'{}'}。全項目が既定値を継承）</span>
          </label>
          <label className="cv-toggle">
            <input type="radio" name="template" checked={template === 'copy'} onChange={() => setTemplate('copy')} />
            <span>複製元:</span>
            <select className="cv-select" value={base} disabled={template !== 'copy'} onChange={(event) => setBase(event.target.value)}>
              {presets.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {dirty > 0 ? (
          <label className="cv-toggle">
            <input type="checkbox" checked={inherit} onChange={(event) => setInherit(event.target.checked)} />
            <span>現在の未保存の変更（{dirty} 項目）を新しいファイルへ引き継ぐ</span>
          </label>
        ) : null}
        {exists ? <p className="cv-alert is-warning">同名のファイルが既にあります</p> : null}
        {error ? <p className="cv-alert is-error">{error}</p> : null}
        <div className="cv-conflictActions">
          <button type="button" className="cv-button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="cv-button cv-buttonPrimary" disabled={!valid || exists || saving}>
            {saving ? '作成中...' : '作成'}
          </button>
        </div>
      </form>
    </div>
  )
}
