import { useEffect, useState } from 'react'
import { getResult, listOutputs } from '../api'
import { copyText } from '../lib/format'
import { useEditorContext } from '../schema-form/EditorContext'
import { getAtPath } from '../schema-form/resolveSchema'
import type { OutputEntry, ResultResponse } from '../types'

// ビルド後の概要欄（.youtube.txt）・固定コメント（.comment*.txt）・meta.json を表示してコピーできるようにする。
export function SummaryPanel() {
  const context = useEditorContext()
  const [outputs, setOutputs] = useState<OutputEntry[]>([])
  const [selectedBase, setSelectedBase] = useState<string | null>(null)
  const [result, setResult] = useState<ResultResponse | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const maxCharsValue = getAtPath(context.resolved, ['summary', 'maxChars'])
  const maxChars = typeof maxCharsValue === 'number' ? maxCharsValue : 5000

  useEffect(() => {
    let ignore = false
    void listOutputs()
      .then((list) => {
        if (!ignore) {
          setOutputs(list)
          setSelectedBase((current) => current ?? list.find((entry) => entry.sidecars.youtube)?.base ?? list[0]?.base ?? null)
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
  }, [])

  useEffect(() => {
    if (!selectedBase) {
      return undefined
    }
    let ignore = false
    void getResult(selectedBase)
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
  }, [selectedBase])

  const copy = async (label: string, text: string) => {
    const ok = await copyText(text)
    setCopied(ok ? `${label} をコピーしました` : 'コピーできませんでした')
    window.setTimeout(() => setCopied(''), 2000)
  }

  const meta = result?.meta ?? null
  const chapters = Array.isArray(meta?.chapters) ? meta.chapters : []
  const titleCandidates = Array.isArray(meta?.titleCandidates) ? meta.titleCandidates : []
  const tags = Array.isArray(meta?.tags) ? meta.tags : []

  return (
    <div className="cv-summaryPanel">
      <div className="cv-sectionHeader">
        <h2>概要欄</h2>
        <select className="cv-select" value={selectedBase ?? ''} onChange={(event) => setSelectedBase(event.target.value || null)}>
          {outputs.length === 0 ? <option value="">（出力なし）</option> : null}
          {outputs.map((entry) => (
            <option key={entry.base} value={entry.base}>
              {entry.base}
              {entry.sidecars.youtube ? '' : '（概要欄なし）'}
            </option>
          ))}
        </select>
        {copied ? <span className="cv-hint">{copied}</span> : null}
      </div>
      {error ? <p className="cv-alert is-error">{error}</p> : null}
      {!result ? <p className="cv-empty">ビルドすると output/&lt;name&gt;.youtube.txt がここに出ます</p> : null}

      {result?.youtube !== null && result?.youtube !== undefined ? (
        <TextBlock
          title="youtube.txt"
          text={result.youtube}
          maxChars={maxChars}
          onCopy={() => void copy('youtube.txt', result.youtube ?? '')}
        />
      ) : null}
      {result?.comments.map((text, index) => (
        <TextBlock
          key={index}
          title={result.comments.length > 1 ? `comment-${index + 1}.txt` : 'comment.txt'}
          text={text}
          maxChars={maxChars}
          onCopy={() => void copy(`comment ${index + 1}`, text)}
        />
      ))}

      {meta ? (
        <details className="cv-objectDetails" open>
          <summary>meta.json</summary>
          <div className="cv-metaGrid">
            <div>
              <strong>タイトル案</strong>
              {titleCandidates.length === 0 ? <p className="cv-hint">（なし）</p> : null}
              <ul>
                {titleCandidates.map((item, index) => (
                  <li key={index}>
                    {String(item)}{' '}
                    <button type="button" className="cv-helpButton" onClick={() => void copy('タイトル', String(item))}>
                      コピー
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>タグ</strong>
              <p>{tags.length > 0 ? tags.map(String).join(', ') : <span className="cv-hint">（なし）</span>}</p>
              {tags.length > 0 ? (
                <button type="button" className="cv-button cv-buttonSmall" onClick={() => void copy('タグ', tags.map(String).join(','))}>
                  カンマ区切りでコピー
                </button>
              ) : null}
            </div>
            <div>
              <strong>チャプター</strong>
              {chapters.length === 0 ? <p className="cv-hint">（なし。3 個未満は概要欄から省かれます）</p> : null}
              <table className="cv-table">
                <tbody>
                  {chapters.map((chapter, index) => {
                    const row = chapter as Record<string, unknown>
                    return (
                      <tr key={index}>
                        <td>{String(row.time ?? row.at ?? '')}</td>
                        <td>{String(row.label ?? row.title ?? '')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  )
}

function TextBlock({ title, text, maxChars, onCopy }: { title: string; text: string; maxChars: number; onCopy(): void }) {
  const length = [...text].length
  return (
    <details className="cv-objectDetails" open>
      <summary>
        {title}{' '}
        <span className={length > maxChars ? 'cv-charCount is-over' : 'cv-charCount'}>
          {length.toLocaleString()} / {maxChars.toLocaleString()} 文字
        </span>
        <button type="button" className="cv-button cv-buttonSmall" onClick={(event) => { event.preventDefault(); onCopy() }}>
          コピー
        </button>
      </summary>
      <pre className="cv-json cv-jsonSmall">{text}</pre>
    </details>
  )
}
