import { useMemo, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { fileUrl } from '../api'
import type { ClipsState } from '../hooks/useClips'
import { formatClock, formatDateCompact, firstLine } from '../lib/format'
import { useEditorContext } from '../schema-form/EditorContext'
import type { ClipInfo } from '../types'

type ClipsPanelProps = {
  clips: ClipsState
}

const MODES: Array<{ id: 'videoId' | 'category' | 'files'; label: string }> = [
  { id: 'videoId', label: 'videoId' },
  { id: 'category', label: 'category' },
  { id: 'files', label: 'files' },
]
const ORDERS = ['date', 'date-desc', 'stream', 'shuffle', 'as-listed']
// 出力 1 秒あたりのビルド時間（実測 0.63 秒）。
const BUILD_SEC_PER_OUTPUT_SEC = 0.63

export function ClipsPanel({ clips }: ClipsPanelProps) {
  const context = useEditorContext()
  const select = (isRecord(context.draft.select) ? context.draft.select : {}) as Record<string, unknown>
  const resolvedSelect = (isRecord(context.resolved.select) ? context.resolved.select : {}) as Record<string, unknown>
  const mode = String(resolvedSelect.mode ?? 'videoId')
  const order = String(resolvedSelect.order ?? 'date')
  const files = useMemo(() => normalizeFiles(select.files), [select.files])
  const categories = useMemo(() => stringArray(resolvedSelect.categories), [resolvedSelect.categories])
  const exclude = useMemo(() => stringArray(resolvedSelect.exclude), [resolvedSelect.exclude])
  const limit = typeof resolvedSelect.limit === 'number' ? resolvedSelect.limit : null
  const videoId = typeof resolvedSelect.videoId === 'string' ? resolvedSelect.videoId : ''
  const canReorder = mode === 'files' && order === 'as-listed'
  const response = clips.response
  const selected = response?.clips ?? []
  const catalog = response?.catalog

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [hoverBase, setHoverBase] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [candidateVideoId, setCandidateVideoId] = useState('')
  const [candidateCategory, setCandidateCategory] = useState('')
  const [excludeInput, setExcludeInput] = useState('')

  const setSelect = (key: string, value: unknown) => context.setValue(['select', key], value)
  const setFiles = (next: string[]) => setSelect('files', next)

  const totalSec = selected.reduce((sum, clip) => sum + (Number(clip.duration) || 0), 0)
  const estimate = estimateBuildSeconds(context.resolved, selected.length, totalSec)

  const pinAsFiles = () => {
    setFiles(selected.map((clip) => clip.base))
    setSelect('mode', 'files')
    setSelect('order', 'as-listed')
    setSelect('limit', null)
  }

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) {
      return
    }
    const next = [...files]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setFiles(next)
  }

  const removeClip = (clip: ClipInfo) => {
    if (mode === 'files') {
      setFiles(files.filter((base) => base !== clip.base))
    } else if (!exclude.includes(clip.base)) {
      setSelect('exclude', [...exclude, clip.base])
    }
  }

  const addCandidate = (base: string) => {
    if (!files.includes(base)) {
      setFiles([...files, base])
    }
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number, clip: ClipInfo) => {
    if (event.altKey && event.key === 'ArrowUp' && canReorder) {
      event.preventDefault()
      reorder(index, index - 1)
      focusRow(event.currentTarget, index - 1)
    } else if (event.altKey && event.key === 'ArrowDown' && canReorder) {
      event.preventDefault()
      reorder(index, index + 1)
      focusRow(event.currentTarget, index + 1)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeClip(clip)
    }
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault()
    if (dragIndex !== null) {
      reorder(dragIndex, index)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  const candidates = useMemo(() => {
    if (!catalog || mode !== 'files') {
      return []
    }
    const fileSet = new Set(files)
    const keyword = search.trim()
    return catalog.clips.filter((clip) => {
      if (fileSet.has(clip.base)) {
        return false
      }
      if (candidateVideoId && clip.videoId !== candidateVideoId) {
        return false
      }
      if (candidateCategory && !clip.categories.includes(candidateCategory)) {
        return false
      }
      if (keyword && !`${clip.serif} ${clip.title} ${clip.base}`.includes(keyword)) {
        return false
      }
      return true
    })
  }, [candidateCategory, candidateVideoId, catalog, files, mode, search])

  return (
    <div className="cv-clips">
      <section className="cv-clipsControls">
        <div className="cv-controlRow">
          <span className="cv-controlLabel">モード</span>
          <div className="cv-segmented" role="radiogroup">
            {MODES.map((option) => (
              <button
                type="button"
                key={option.id}
                className={mode === option.id ? 'cv-segment is-active' : 'cv-segment'}
                aria-pressed={mode === option.id}
                onClick={() => setSelect('mode', option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {mode === 'videoId' ? (
            <select className="cv-select" value={videoId} onChange={(event) => setSelect('videoId', event.target.value || null)}>
              <option value="">（未選択）</option>
              {(catalog?.videoIds ?? []).map((entry) => (
                <option key={entry.videoId} value={entry.videoId}>
                  {formatDateCompact(entry.uploadDate)} {entry.videoId} ({entry.count}) {entry.title.slice(0, 24)}
                </option>
              ))}
            </select>
          ) : null}
          <label className="cv-inlineField">
            <span>order</span>
            <select className="cv-select" value={order} onChange={(event) => setSelect('order', event.target.value)}>
              {ORDERS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="cv-inlineField">
            <span>limit</span>
            <input
              className="cv-input cv-inputShort"
              type="number"
              min={1}
              value={limit ?? ''}
              onChange={(event) => setSelect('limit', event.target.value === '' ? null : Number(event.target.value))}
            />
          </label>
        </div>

        {mode === 'category' ? (
          <div className="cv-controlRow">
            <span className="cv-controlLabel">categories</span>
            <div className="cv-chipList">
              {(catalog?.categories ?? []).map((entry) => {
                const active = categories.includes(entry.name)
                return (
                  <button
                    type="button"
                    key={entry.name}
                    className={active ? 'cv-chip is-active' : 'cv-chip'}
                    onClick={() => setSelect('categories', active ? categories.filter((name) => name !== entry.name) : [...categories, entry.name])}
                  >
                    {entry.name} ({entry.count})
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="cv-controlRow">
          <span className="cv-controlLabel">exclude</span>
          <div className="cv-chipList">
            {exclude.map((entry) => (
              <button type="button" key={entry} className="cv-chip" onClick={() => setSelect('exclude', exclude.filter((item) => item !== entry))}>
                {entry} ×
              </button>
            ))}
            <input
              className="cv-input cv-inputShort"
              type="text"
              placeholder="base または videoId"
              value={excludeInput}
              onChange={(event) => setExcludeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && excludeInput.trim()) {
                  event.preventDefault()
                  setSelect('exclude', [...exclude, excludeInput.trim()])
                  setExcludeInput('')
                }
              }}
            />
          </div>
          <button type="button" className="cv-button" onClick={pinAsFiles} disabled={selected.length === 0}>
            この選択を files に固定
          </button>
        </div>

        <p className="cv-clipsSummary">
          選択 {selected.length} 件 / 合計 {formatClock(totalSec)} / 推定ビルド 約 {formatClock(estimate)}
          {clips.state === 'pending' ? ' / 取得中...' : ''}
          {!canReorder && mode === 'files' ? ' / 並べ替えるには order を as-listed にする' : ''}
          {!canReorder && mode !== 'files' ? ' / 並べ替えるには「files に固定」' : ''}
        </p>
        {response?.warning ? <p className="cv-alert is-warning">{response.warning}</p> : null}
        {response?.error ? <p className="cv-alert is-error">{response.error}</p> : null}
        {clips.state === 'error' ? <p className="cv-alert is-error">{clips.error}</p> : null}
      </section>

      <div className={mode === 'files' ? 'cv-clipsBody has-candidates' : 'cv-clipsBody'}>
        <ol className="cv-clipList" aria-label="選択中のクリップ">
          {selected.map((clip, index) => (
            <li
              key={`${clip.base}:${index}`}
              className={[
                'cv-clipRow',
                overIndex === index ? 'is-over' : '',
                dragIndex === index ? 'is-dragging' : '',
              ].filter(Boolean).join(' ')}
              tabIndex={0}
              draggable={canReorder}
              data-index={index}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                if (canReorder) {
                  event.preventDefault()
                  setOverIndex(index)
                }
              }}
              onDragLeave={() => setOverIndex((current) => (current === index ? null : current))}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={() => {
                setDragIndex(null)
                setOverIndex(null)
              }}
              onKeyDown={(event) => onRowKeyDown(event, index, clip)}
              onMouseEnter={() => setHoverBase(clip.base)}
              onMouseLeave={() => setHoverBase((current) => (current === clip.base ? null : current))}
            >
              <span className="cv-clipHandle" aria-hidden="true">{canReorder ? '≡' : ''}</span>
              <span className="cv-clipIndex">{index + 1}</span>
              <span className="cv-clipThumb">
                {hoverBase === clip.base ? (
                  <video src={`${import.meta.env.BASE_URL}videos/${clip.base}.mp4`} muted autoPlay loop playsInline />
                ) : (
                  <img src={fileUrl('thumb', clip.videoId)} alt="" loading="lazy" />
                )}
              </span>
              <span className="cv-clipMain">
                <span className="cv-clipSerif">{firstLine(clip.serif) || '（セリフなし）'}</span>
                <span className="cv-clipMeta">
                  {formatDateCompact(clip.uploadDate)} · {clip.videoId} · {clip.title.slice(0, 28)}
                </span>
              </span>
              <span className="cv-clipDuration">{formatSecondsShort(clip.duration)}</span>
              <SourceBadge source={clip.source} preferCache={String(context.resolved.source) === 'cache'} />
              <button type="button" className="cv-iconButton" aria-label={`${clip.base} を除外`} title={mode === 'files' ? 'files から外す' : 'exclude に追加'} onClick={() => removeClip(clip)}>
                ×
              </button>
            </li>
          ))}
          {selected.length === 0 ? <li className="cv-clipEmpty">選択条件に一致するクリップがありません</li> : null}
        </ol>

        {mode === 'files' ? (
          <aside className="cv-candidates" aria-label="追加候補">
            <div className="cv-candidateFilters">
              <input className="cv-input" type="text" placeholder="検索（セリフ / タイトル / base）" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select className="cv-select" value={candidateVideoId} onChange={(event) => setCandidateVideoId(event.target.value)}>
                <option value="">videoId: すべて</option>
                {(catalog?.videoIds ?? []).map((entry) => (
                  <option key={entry.videoId} value={entry.videoId}>
                    {formatDateCompact(entry.uploadDate)} {entry.videoId} ({entry.count})
                  </option>
                ))}
              </select>
              <select className="cv-select" value={candidateCategory} onChange={(event) => setCandidateCategory(event.target.value)}>
                <option value="">カテゴリ: すべて</option>
                {(catalog?.categories ?? []).map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name} ({entry.count})
                  </option>
                ))}
              </select>
            </div>
            <ul className="cv-candidateList">
              {candidates.map((clip) => (
                <li key={clip.base} className="cv-candidateRow">
                  <button type="button" className="cv-button cv-buttonSmall" onClick={() => addCandidate(clip.base)} aria-label={`${clip.base} を追加`}>
                    ＋
                  </button>
                  <span className="cv-clipMain">
                    <span className="cv-clipSerif">{firstLine(clip.serif) || '（セリフなし）'}</span>
                    <span className="cv-clipMeta">{formatDateCompact(clip.uploadDate)} · {clip.videoId} · {formatSecondsShort(clip.duration)}</span>
                  </span>
                </li>
              ))}
              {candidates.length === 0 ? <li className="cv-clipEmpty">候補なし</li> : null}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function SourceBadge({ source, preferCache }: { source: ClipInfo['source']; preferCache: boolean }) {
  if (source.cache) {
    return <span className="cv-sourceBadge is-hq" title="cache/createVideo に 1080p あり">HQ</span>
  }
  if (source.existing) {
    return (
      <span className={preferCache ? 'cv-sourceBadge is-lq is-warn' : 'cv-sourceBadge is-lq'} title={preferCache ? 'source=cache だがキャッシュが無い（ビルド時に yt-dlp で取得）' : 'public/videos の 256x144'}>
        LQ
      </span>
    )
  }
  return <span className="cv-sourceBadge is-missing" title="mp4 が無い">なし</span>
}

function estimateBuildSeconds(resolved: Record<string, unknown>, count: number, totalSec: number): number {
  const cards = isRecord(resolved.cards) ? resolved.cards : {}
  const endcaps = isRecord(resolved.endcaps) ? resolved.endcaps : {}
  const opening = isRecord(endcaps.opening) ? endcaps.opening : {}
  const ending = isRecord(endcaps.ending) ? endcaps.ending : {}
  const cardSec = cards.enabled === false ? 0 : count * (Number(cards.duration) || 0)
  const openingSec = opening.enabled === false ? 0 : Number(opening.duration) || 0
  const endingSec = ending.enabled === false ? 0 : Number(ending.duration) || 0
  return (totalSec + cardSec + openingSec + endingSec) * BUILD_SEC_PER_OUTPUT_SEC
}

function focusRow(current: HTMLElement, index: number) {
  const list = current.parentElement
  window.requestAnimationFrame(() => {
    const target = list?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    target?.focus()
  })
}

function normalizeFiles(value: unknown): string[] {
  return stringArray(value).map((entry) => entry.replace(/\.json$/u, ''))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function formatSecondsShort(seconds: number): string {
  return `${(Number(seconds) || 0).toFixed(1)}s`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
