import { useEffect, useRef, useState } from 'react'
import { generateRuby, transcribeClip } from '../../lib/devDataEditor'
import type { KeyboardEvent } from 'react'
import { normalizeSerifForDisplay } from '../../voiceData'
import type { ClipReview, VoiceClip, VoiceData } from '../../voiceData'
import { reviewClip } from '../../../scripts/dev-server/lib/clip-review.js'
import type { AcknowledgeableIssueKind } from '../../../scripts/dev-server/lib/clip-review.js'
import { ClipReviewPanel } from './ClipReviewPanel'
import { SerifSpacingPreview } from './SerifSpacingPreview'
import { TrimEditor } from './TrimEditor'

// dev 限定のクリップ編集モーダル。本番ビルドには含めない（App 側で import.meta.env.DEV でガード）。
// 文言はローカル開発専用のため i18n を通さず素の日本語で書く。

type ClipEditModalProps = {
  clip: VoiceClip
  categorySuggestions: string[]
  // public/videos に mp4 があるか。undefined は未確認（動画の有無は判定しない）。
  hasVideo?: boolean
  onClose: () => void
  onSaved: (fileBaseName: string, updated: VoiceData, options?: { cacheBustVideo?: boolean }) => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function ClipEditModal({ clip, categorySuggestions, hasVideo, onClose, onSaved }: ClipEditModalProps) {
  // 表示用に改行・強調記法を落とした serif ではなく JSON の値から始める。そのまま保存しても、
  // まとめ動画のテロップ用の改行と強調記法が消えないように。
  const [serif, setSerif] = useState(clip.rawSerif)
  const [ruby, setRuby] = useState(clip.ruby)
  const [memo, setMemo] = useState(clip.memo)
  const [categories, setCategories] = useState<string[]>(clip.categories)
  // 「このままで良い」の記録。保存するまで JSON には書かない。
  const [review, setReview] = useState<ClipReview>(clip.review ?? {})
  const [newCategory, setNewCategory] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [generation, setGeneration] = useState<'transcribe' | 'ruby' | null>(null)
  const [generationMessage, setGenerationMessage] = useState('')
  const [generationError, setGenerationError] = useState(false)
  const generationRequest = useRef<AbortController | null>(null)

  useEffect(() => () => {
    generationRequest.current?.abort()
  }, [clip.fileBaseName])

  const handleClose = () => {
    generationRequest.current?.abort()
    onClose()
  }

  const handleGenerate = async (kind: 'transcribe' | 'ruby') => {
    if (generationRequest.current) {
      return
    }
    const controller = new AbortController()
    generationRequest.current = controller
    setGeneration(kind)
    setGenerationMessage('')
    setGenerationError(false)
    setStatus('idle')
    try {
      if (kind === 'transcribe') {
        const result = await transcribeClip(clip.fileBaseName, controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setSerif(result.serif)
        setRuby(result.ruby)
        setGenerationMessage('文字起こし結果を入れました（未保存）')
      } else {
        // 読みは表示上の文字から作る（改行で割った語や強調記法の記号を読みに混ぜない）。
        const result = await generateRuby(normalizeSerifForDisplay(serif), controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setRuby(result.ruby)
        setGenerationMessage('serif から読みを作りました（未保存）')
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      setGenerationError(true)
      setGenerationMessage(error instanceof Error ? error.message : String(error))
    } finally {
      if (generationRequest.current === controller) {
        generationRequest.current = null
        if (!controller.signal.aborted) {
          setGeneration(null)
        }
      }
    }
  }

  const generating = generation !== null
  // 保存・生成のどちらかが走っている間は、ほかの書き込み操作を止める。
  const busy = generating || status === 'saving'

  // 入力中の値で要対応を判定する（JSON と同じ形にして渡す）。trim の判定は clip の trimming から。
  const reviewResult = reviewClip({ ...clip, serif, ruby, review }, { hasVideo })

  const acknowledge = (kind: AcknowledgeableIssueKind) => {
    setReview((current) => {
      if (kind === 'trim') {
        return { ...current, trim: true }
      }
      if (kind === 'ruby') {
        return { ...current, ruby }
      }
      return { ...current, serif }
    })
  }

  const revoke = (kind: AcknowledgeableIssueKind) => {
    setReview((current) => {
      const next = { ...current }
      delete next[kind]
      return next
    })
  }

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
    setGenerationMessage('')
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
          review,
        }),
      })

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(detail?.error ?? `保存に失敗しました (${response.status})`)
      }

      const updated = (await response.json()) as VoiceData
      onSaved(clip.fileBaseName, updated)
      setCategories(updated.categories)
      // サーバ側で今の値と合わない記録は落ちるので、戻ってきた値に揃える。
      setReview(updated.review ?? {})
      setStatus('saved')
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  // 波形の下までスクロールしなくても保存できるよう、上部と下部の両方に置く。
  const saveButton = (
    <button
      type="button"
      className="clip-edit-save"
      onClick={() => void handleSave()}
      disabled={busy}
    >
      {status === 'saving' ? '保存中…' : '保存'}
    </button>
  )

  return (
    <div className="clip-edit-backdrop" role="presentation" onClick={handleClose}>
      <section
        className="clip-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="クリップ編集"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="clip-edit-header">
          <div className="clip-edit-header-text">
            <h2 className="clip-edit-title">クリップ編集 <span className="clip-edit-badge">DEV</span></h2>
            <p className="clip-edit-filename">{clip.fileBaseName}.json</p>
          </div>
          <div className="clip-edit-header-actions">
            {status === 'saved' ? <span className="clip-edit-header-status is-saved">✓ 保存しました</span> : null}
            {status === 'error' ? <span className="clip-edit-header-status is-error">⚠ 保存に失敗しました</span> : null}
            {saveButton}
          </div>
        </header>

        <ClipReviewPanel
          result={reviewResult}
          review={review}
          savedReview={clip.review}
          disabled={busy}
          onAcknowledge={acknowledge}
          onRevoke={revoke}
        />

        <TrimEditor clip={clip} hasVideo={hasVideo} onSaved={onSaved} />

        <div className="clip-edit-field">
          <div className="clip-edit-label-row">
            <label className="clip-edit-label" htmlFor="clip-edit-serif">serif（セリフ）</label>
            <button
              type="button"
              className="clip-edit-generate"
              disabled={busy || hasVideo === false}
              title={hasVideo === false ? '動画が未ダウンロードのため文字起こしできません' : undefined}
              onClick={() => void handleGenerate('transcribe')}
            >
              {generation === 'transcribe' ? '文字起こし中…' : '🎤 文字起こし'}
            </button>
          </div>
          <textarea
            id="clip-edit-serif"
            className="clip-edit-textarea"
            disabled={generating}
            rows={3}
            value={serif}
            onChange={(event) => setSerif(event.target.value)}
          />
          <SerifSpacingPreview serif={serif} />
        </div>

        <div className="clip-edit-field">
          <div className="clip-edit-label-row">
            <label className="clip-edit-label" htmlFor="clip-edit-ruby">ruby（読み・並び替えキー）</label>
            <button type="button" className="clip-edit-generate" disabled={busy} onClick={() => void handleGenerate('ruby')}>
              {generation === 'ruby' ? '読みを生成中…' : 'serif から読みを作る'}
            </button>
          </div>
          <input
            className="clip-edit-input"
            type="text"
            id="clip-edit-ruby"
            disabled={generating}
            value={ruby}
            onChange={(event) => setRuby(event.target.value)}
          />
        </div>

        {generationMessage ? <p className={`clip-edit-status ${generationError ? 'is-error' : 'is-saved'}`} role={generationError ? 'alert' : 'status'}>{generationMessage}</p> : null}

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
          <button type="button" className="clip-edit-cancel" onClick={handleClose}>
            閉じる
          </button>
          {saveButton}
        </div>
      </section>
    </div>
  )
}
