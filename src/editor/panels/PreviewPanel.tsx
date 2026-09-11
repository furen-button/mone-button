import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { saveClipData } from '../api'
import { useStill } from '../hooks/useStill'
import { formatSeconds } from '../lib/format'
import { useEditorContext } from '../schema-form/EditorContext'
import { getAtPath } from '../schema-form/resolveSchema'
import { SchemaFieldList } from '../schema-form/SchemaForm'
import type { StillKind, StillRequest } from '../types'

type PreviewPanelProps = {
  presetName: string
  onSavePreset(): Promise<void>
  onClipDataSaved(): void
}

const SERIF_KNOBS: string[][] = [
  ['telops', 'serif', 'size'],
  ['telops', 'serif', 'minSize'],
  ['telops', 'serif', 'maxHeight'],
  ['telops', 'serif', 'align'],
  ['telops', 'serif', 'box', 'pad'],
  ['telops', 'serif', 'box', 'radius'],
  ['telops', 'serif', 'box', 'opacity'],
]

type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; message: string }

// ?kind=card のように初期表示を URL から指定できる（?tab= / ?preset= と同じ用途。スクショ取得で使う）。
const initialKind: StillKind = (() => {
  const value = new URLSearchParams(window.location.search).get('kind')
  return value === 'card' || value === 'opening' || value === 'ending' ? value : 'clip'
})()

// 区切りカードは選択中クリップの「前」に入るもの。OP / ED はクリップに紐づかない。
const KIND_LABELS: Array<{ kind: StillKind; label: string; hint: string }> = [
  { kind: 'opening', label: 'OP', hint: 'オープニング' },
  { kind: 'card', label: 'カード', hint: '選択中クリップの前に入る区切りカード' },
  { kind: 'clip', label: 'クリップ', hint: 'クリップ本編' },
  { kind: 'ending', label: 'ED', hint: 'エンディング' },
]

// 静止画プレビュー。本番と同じ renderStill を dev サーバ経由で呼び、返ってきた矩形を PNG に重ねる。
export function PreviewPanel({ presetName, onSavePreset, onClipDataSaved }: PreviewPanelProps) {
  const context = useEditorContext()
  const clips = context.preflight.response?.preflight?.clips ?? []
  const [selectedBase, setSelectedBase] = useState<string | null>(null)
  const [kind, setKind] = useState<StillKind>(initialKind)
  const clipIndex = Math.max(0, clips.findIndex((clip) => clip.base === selectedBase))
  const clip = clips[clipIndex] ?? null
  const needsClip = kind === 'clip' || kind === 'card'
  // 時刻指定は対象（種別 + クリップ）ごとに持ち、対象が変われば自動的に既定（中央）へ戻る。
  const targetKey = `${kind}:${needsClip ? clip?.base ?? '' : ''}`
  const [atEdit, setAtEdit] = useState<{ key: string; at: number } | null>(null)
  const at = atEdit?.key === targetKey ? atEdit.at : undefined
  const setAt = (value: number | undefined) => setAtEdit(value === undefined ? null : { key: targetKey, at: value })
  const [serifEdit, setSerifEdit] = useState<{ base: string; text: string } | null>(null)
  const [titleEdit, setTitleEdit] = useState<{ videoId: string; text: string } | null>(null)
  const [zoom, setZoom] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const [dataSave, setDataSave] = useState<SaveState>({ kind: 'idle', message: '' })

  const serif = clip && serifEdit?.base === clip.base ? serifEdit.text : clip?.serif ?? ''
  const existingOverride = clip ? getAtPath(context.draft, ['telops', 'title', 'overrides', clip.videoId]) : undefined
  const title = clip && titleEdit?.videoId === clip.videoId ? titleEdit.text : typeof existingOverride === 'string' ? existingOverride : ''

  const request = useMemo<StillRequest | null>(() => {
    if (!presetName || (needsClip && !clip)) {
      return null
    }
    return {
      name: presetName,
      draft: context.draft,
      kind,
      clipBase: needsClip && clip ? clip.base : undefined,
      at,
      title: needsClip && title ? title : undefined,
      serifOverride: needsClip && clip && serif !== clip.serif ? serif : undefined,
      zoom: kind === 'clip' ? zoom : false,
    }
  }, [at, clip, context.draft, kind, needsClip, presetName, serif, title, zoom])
  const available = KIND_LABELS.filter((entry) => {
    if (entry.kind === 'card') {
      return getAtPath(context.resolved, ['cards', 'enabled']) !== false
    }
    if (entry.kind === 'opening' || entry.kind === 'ending') {
      return getAtPath(context.resolved, ['endcaps', entry.kind, 'enabled']) !== false
    }
    return true
  })
  const still = useStill(request)
  const meta = still.meta
  const duration = meta?.source.duration ?? clip?.duration ?? 0
  const currentAt = at ?? meta?.at ?? 0

  const moveClip = (delta: number) => {
    const next = clips[clipIndex + delta]
    if (next) {
      setSelectedBase(next.base)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT') {
      return
    }
    const step = event.shiftKey ? 2.5 : 0.5
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setAt(Math.max(0, currentAt - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setAt(Math.min(Math.max(0, duration - 0.05), currentAt + step))
    } else if (event.key === '[') {
      moveClip(-1)
    } else if (event.key === ']') {
      moveClip(1)
    }
  }

  const saveToData = async () => {
    if (!clip) {
      return
    }
    setDataSave({ kind: 'saving', message: '' })
    try {
      await saveClipData({ fileBaseName: clip.base, serif })
      setSerifEdit(null)
      setDataSave({ kind: 'saved', message: `public/data/${clip.base}.json を保存しました` })
      onClipDataSaved()
    } catch (error) {
      setDataSave({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const saveToPreset = async () => {
    if (!clip) {
      return
    }
    if (title) {
      context.setValue(['telops', 'title', 'overrides', clip.videoId], title)
    } else if (typeof existingOverride === 'string') {
      context.unsetValue(['telops', 'title', 'overrides', clip.videoId])
    }
    setTitleEdit(null)
    await onSavePreset()
  }

  if (!presetName) {
    return <p className="cv-empty">プリセットを選択してください</p>
  }
  if (clips.length === 0) {
    return (
      <p className="cv-empty">
        {context.preflight.state === 'pending' ? '検証中...' : 'プレビューできるクリップがありません（選択条件を確認してください）'}
      </p>
    )
  }

  return (
    <div className="cv-preview" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="cv-previewToolbar">
        {available.length > 1 ? (
          <div className="cv-segmented" role="radiogroup" aria-label="プレビュー対象">
            {available.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                className={kind === entry.kind ? 'cv-segment is-active' : 'cv-segment'}
                aria-pressed={kind === entry.kind}
                title={entry.hint}
                onClick={() => setKind(entry.kind)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="cv-button" onClick={() => moveClip(-1)} disabled={!needsClip || clipIndex <= 0} aria-label="前のクリップ">
          ◀
        </button>
        <select
          className="cv-select cv-previewClipSelect"
          value={clip?.base ?? ''}
          disabled={!needsClip}
          onChange={(event) => setSelectedBase(event.target.value)}
        >
          {clips.map((entry, index) => (
            <option key={entry.base} value={entry.base}>
              {index + 1}/{clips.length} {entry.base} 「{entry.serif.split(/\r?\n/u)[0]?.slice(0, 18)}」
            </option>
          ))}
        </select>
        <button type="button" className="cv-button" onClick={() => moveClip(1)} disabled={!needsClip || clipIndex >= clips.length - 1} aria-label="次のクリップ">
          ▶
        </button>
        <label className="cv-toggle">
          <input type="checkbox" checked={zoom} disabled={kind !== 'clip'} onChange={(event) => setZoom(event.target.checked)} />
          <span>ズーム適用（顔検出で +2〜3 秒）</span>
        </label>
        <label className="cv-toggle">
          <input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} />
          <span>矩形</span>
        </label>
      </div>

      <div className="cv-previewBody">
        <div className="cv-previewStage">
          <div className={still.state === 'pending' ? 'cv-previewFrame is-pending' : 'cv-previewFrame'}>
            {still.url ? (
              <img src={still.url} alt={clip ? `${clip.base} のプレビュー` : ''} />
            ) : (
              <div className="cv-previewPlaceholder">{still.state === 'pending' ? '描画中...' : still.state === 'error' ? '描画できませんでした' : ''}</div>
            )}
            {showOverlay && meta && still.url
              ? meta.elements.map((element) => (
                  <div
                    key={element.name}
                    className={`cv-previewRect is-${element.name}`}
                    style={{
                      left: `${(element.rect.x / meta.size.width) * 100}%`,
                      top: `${(element.rect.y / meta.size.height) * 100}%`,
                      width: `${(element.rect.w / meta.size.width) * 100}%`,
                      height: `${(element.rect.h / meta.size.height) * 100}%`,
                    }}
                  >
                    <span>{element.name} ({element.lines.length} 行 / {element.fontSize}px)</span>
                  </div>
                ))
              : null}
          </div>
          <div className="cv-previewScrub">
            <input
              type="range"
              min={0}
              max={Math.max(0.05, duration - 0.05)}
              step={0.05}
              value={Math.min(currentAt, Math.max(0.05, duration - 0.05))}
              onChange={(event) => setAt(Number(event.target.value))}
              aria-label="時刻"
            />
            <span className="cv-previewTime">
              {formatSeconds(currentAt)} / {formatSeconds(duration)}
              {at === undefined ? '（中央）' : ''}
            </span>
            <button type="button" className="cv-button cv-buttonSmall" onClick={() => setAt(undefined)} disabled={at === undefined}>
              中央へ
            </button>
          </div>
          <div className="cv-previewStatus">
            {meta ? (
              <span>
                {meta.size.width}x{meta.size.height} · ソース {meta.source.width}x{meta.source.height}（{meta.source.kind}）· {meta.cached ? 'キャッシュ' : `${meta.ms} ms`} · {meta.index + 1}/{meta.total}
              </span>
            ) : null}
            {still.state === 'error' ? <span className="cv-previewError">{still.error}</span> : null}
          </div>
          {meta && meta.warnings.length > 0 ? (
            <ul className="cv-previewWarnings">
              {meta.warnings.map((warning) => (
                <li key={warning.code}>
                  <code>{warning.code}</code> {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <aside className="cv-previewSide">
          {!needsClip ? (
            <p className="cv-hint">
              {kind === 'opening' ? 'OP' : 'ED'} の文言は「設定」タブの endcaps.{kind} で編集します。
            </p>
          ) : null}
          {needsClip ? (
            <>
          <label className="cv-fieldStack">
            <span className="cv-controlLabel">セリフ（改行はそのまま強制改行）</span>
            <textarea
              className="cv-textarea"
              rows={4}
              value={serif}
              onChange={(event) => clip && setSerifEdit({ base: clip.base, text: event.target.value })}
            />
          </label>
          <label className="cv-fieldStack">
            <span className="cv-controlLabel">タイトル上書き（telops.title.overrides[{clip?.videoId}]）</span>
            <textarea
              className="cv-textarea"
              rows={2}
              value={title}
              placeholder="空なら配信タイトルをそのまま使う"
              onChange={(event) => clip && setTitleEdit({ videoId: clip.videoId, text: event.target.value })}
            />
          </label>
          <div className="cv-previewKnobs">
            <span className="cv-controlLabel">telops.serif</span>
            <SchemaFieldList paths={SERIF_KNOBS} />
          </div>
          <div className="cv-previewActions">
            <button type="button" className="cv-button" onClick={() => void saveToData()} disabled={!clip || dataSave.kind === 'saving' || serif === clip?.serif}>
              public/data に保存
            </button>
            <button type="button" className="cv-button cv-buttonPrimary" onClick={() => void saveToPreset()} disabled={!clip}>
              プリセットに保存
            </button>
          </div>
          {dataSave.kind === 'saved' ? <p className="cv-alert is-saved">{dataSave.message}</p> : null}
          {dataSave.kind === 'error' ? <p className="cv-alert is-error">{dataSave.message}</p> : null}
            </>
          ) : null}
          <p className="cv-hint">← → で ±0.5 秒（Shift で ±2.5 秒）、[ ] で前後のクリップ</p>
        </aside>
      </div>
    </div>
  )
}
