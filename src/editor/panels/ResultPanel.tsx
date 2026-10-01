import { useEffect, useState } from 'react'
import { fileUrl, getResult } from '../api'
import { formatBytes, formatClock } from '../lib/format'
import type { QcResult, ResultResponse } from '../types'

type ResultPanelProps = {
  base: string | null
  refreshKey: number
  busy: boolean
  onRunQc(contact: boolean): void
}

type Level = 'error' | 'warn' | 'info'

// ビルド結果の sidecar 一式（mp4 / QC / コンタクトシート / render.json）を表示する。
export function ResultPanel({ base, refreshKey, busy, onRunQc }: ResultPanelProps) {
  const [result, setResult] = useState<ResultResponse | null>(null)
  const [error, setError] = useState('')
  const [levelFilter, setLevelFilter] = useState<Level | null>(null)

  useEffect(() => {
    if (!base) {
      return undefined
    }
    let ignore = false
    void getResult(base)
      .then((next) => {
        if (!ignore) {
          setResult(next)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (!ignore) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      ignore = true
    }
  }, [base, refreshKey])

  if (!base) {
    return <p className="cv-empty">ビルド結果はまだありません</p>
  }
  if (error) {
    return <p className="cv-alert is-error">{error}</p>
  }
  if (!result || result.base !== base) {
    return <p className="cv-hint">読み込み中...</p>
  }

  const summary = result.qc?.summary ?? null
  const results = (result.qc?.results ?? []).filter((item) => (levelFilter ? item.level === levelFilter : item.level !== 'info'))

  return (
    <div className="cv-result">
      <div className="cv-resultHeader">
        <h3>{result.base}</h3>
        {result.mp4 ? <span className="cv-hint">{formatBytes(result.mp4.size)}</span> : <span className="cv-alert is-warning">mp4 がありません</span>}
        {result.render ? (
          <span className="cv-hint">
            {result.render.clipCount} clips / {formatClock(result.render.totalSec)} / {result.render.concatMethod}
          </span>
        ) : null}
        <div className="cv-resultActions">
          <button type="button" className="cv-button cv-buttonSmall" onClick={() => onRunQc(false)} disabled={busy || !result.mp4}>
            QC を再実行
          </button>
          <button type="button" className="cv-button cv-buttonSmall" onClick={() => onRunQc(true)} disabled={busy || !result.mp4}>
            コンタクトシート生成
          </button>
        </div>
      </div>

      {result.mp4 ? (
        // キャッシュを避けるため mtime をクエリに付ける（/__cv/file は Range 対応でシーク可）。
        <video className="cv-resultVideo" controls preload="metadata" src={`${fileUrl('mp4', result.base)}&v=${result.mp4.mtimeMs}`} />
      ) : null}

      <section className="cv-resultQc">
        <div className="cv-resultQcHeader">
          <strong>QC</strong>
          {summary ? (
            <>
              {(['error', 'warn', 'info'] as Level[]).map((level) => (
                <button
                  type="button"
                  key={level}
                  className={`cv-statusBadge is-${level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'muted'} ${levelFilter === level ? 'is-selected' : ''}`}
                  onClick={() => setLevelFilter((current) => (current === level ? null : level))}
                >
                  {level} {summary[level]}
                </button>
              ))}
              {result.qc?.generatedAt ? <span className="cv-hint">{result.qc.generatedAt}</span> : null}
            </>
          ) : (
            <span className="cv-hint">QC 結果なし（ビルド時に --qc、または「QC を再実行」）</span>
          )}
        </div>
        {results.length > 0 ? (
          <ul className="cv-qcList">
            {results.map((item, index) => (
              <QcRow key={`${item.code}:${index}`} item={item} />
            ))}
          </ul>
        ) : null}
        {result.qcMd ? (
          <details className="cv-objectDetails">
            <summary>.qc.md</summary>
            <pre className="cv-json cv-jsonSmall">{result.qcMd}</pre>
          </details>
        ) : null}
      </section>

      {result.sidecars.contact ? (
        <details className="cv-objectDetails" open>
          <summary>コンタクトシート</summary>
          <a href={fileUrl('contact', result.base)} target="_blank" rel="noreferrer">
            <img className="cv-contactSheet" src={`${fileUrl('contact', result.base)}&v=${refreshKey}`} alt={`${result.base} のコンタクトシート`} />
          </a>
        </details>
      ) : null}
    </div>
  )
}

function QcRow({ item }: { item: QcResult }) {
  return (
    <li className={`is-${item.level}`}>
      <strong>{item.level}</strong> <code>{item.code}</code> {item.message}
      {item.detail ? <span className="cv-resultDetail"> {typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail)}</span> : null}
    </li>
  )
}
