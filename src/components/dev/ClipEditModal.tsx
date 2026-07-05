import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { VoiceClip, VoiceData } from '../../voiceData'

// dev 限定のクリップ編集モーダル。本番ビルドには含めない（App 側で import.meta.env.DEV でガード）。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。

type ClipEditModalProps = {
  clip: VoiceClip
  categorySuggestions: string[]
  onClose: () => void
  onSaved: (fileBaseName: string, updated: VoiceData) => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function ClipEditModal({ clip, categorySuggestions, onClose, onSaved }: ClipEditModalProps) {
  const [serif, setSerif] = useState(clip.serif)
  const [ruby, setRuby] = useState(clip.ruby)
  const [memo, setMemo] = useState(clip.memo)
  const [categories, setCategories] = useState<string[]>(clip.categories)
  const [newCategory, setNewCategory] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const addCategory = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || categories.includes(trimmed)) {
      setNewCategory('')
      return
    }
    setCategories((current) => [...current, trimmed])
    setNewCategory('')
  }

  const removeCategory = (value: string) => {
    setCategories((current) => current.filter((entry) => entry !== value))
  }

  const handleNewCategoryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      addCategory(newCategory)
    }
  }

  const remainingSuggestions = categorySuggestions.filter((option) => !categories.includes(option))

  const handleSave = async () => {
    setStatus('saving')
    setErrorMessage('')

    try {
      const response = await fetch('/__data/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBaseName: clip.fileBaseName,
          serif,
          ruby,
          memo,
          categories,
        }),
      })

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(detail?.error ?? `保存に失敗しました (${response.status})`)
      }

      const updated = (await response.json()) as VoiceData
      onSaved(clip.fileBaseName, updated)
      setCategories(updated.categories)
      setStatus('saved')
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="clip-edit-backdrop" role="presentation" onClick={onClose}>
      <section
        className="clip-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="クリップ編集"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="clip-edit-header">
          <h2 className="clip-edit-title">クリップ編集 <span className="clip-edit-badge">DEV</span></h2>
          <p className="clip-edit-filename">{clip.fileBaseName}.json</p>
        </header>

        <label className="clip-edit-field">
          <span className="clip-edit-label">serif（セリフ）</span>
          <textarea
            className="clip-edit-textarea"
            rows={3}
            value={serif}
            onChange={(event) => setSerif(event.target.value)}
          />
        </label>

        <label className="clip-edit-field">
          <span className="clip-edit-label">ruby（読み・並び替えキー）</span>
          <input
            className="clip-edit-input"
            type="text"
            value={ruby}
            onChange={(event) => setRuby(event.target.value)}
          />
        </label>

        <label className="clip-edit-field">
          <span className="clip-edit-label">memo（メモ）</span>
          <input
            className="clip-edit-input"
            type="text"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </label>

        <div className="clip-edit-field">
          <span className="clip-edit-label">categories（カテゴリ）</span>
          <div className="clip-edit-chips">
            {categories.length > 0 ? (
              categories.map((category) => (
                <span className="clip-edit-chip" key={category}>
                  {category}
                  <button
                    type="button"
                    className="clip-edit-chip-remove"
                    aria-label={`${category} を削除`}
                    onClick={() => removeCategory(category)}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <span className="clip-edit-chips-empty">カテゴリなし</span>
            )}
          </div>
          <div className="clip-edit-category-add">
            <input
              className="clip-edit-input"
              type="text"
              value={newCategory}
              placeholder="カテゴリを追加して Enter"
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={handleNewCategoryKeyDown}
            />
            <button type="button" className="clip-edit-add-button" onClick={() => addCategory(newCategory)}>
              追加
            </button>
          </div>
          {remainingSuggestions.length > 0 ? (
            <div className="clip-edit-suggestions">
              <span className="clip-edit-suggestions-label">既存:</span>
              {remainingSuggestions.map((option) => (
                <button
                  type="button"
                  className="clip-edit-suggestion"
                  key={option}
                  onClick={() => addCategory(option)}
                >
                  ＋{option}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {status === 'saved' ? (
          <p className="clip-edit-status is-saved">
            ✓ 保存しました。カテゴリの新設分をフィルタへ反映するにはリロードしてください。
          </p>
        ) : null}
        {status === 'error' ? <p className="clip-edit-status is-error">⚠ {errorMessage}</p> : null}

        <div className="clip-edit-actions">
          <button type="button" className="clip-edit-cancel" onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            className="clip-edit-save"
            onClick={() => void handleSave()}
            disabled={status === 'saving'}
          >
            {status === 'saving' ? '保存中…' : '保存'}
          </button>
        </div>
      </section>
    </div>
  )
}
