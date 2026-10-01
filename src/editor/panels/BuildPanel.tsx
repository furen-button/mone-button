import { useEffect, useMemo, useRef, useState } from 'react'
import { fileUrl, listOutputs } from '../api'
import type { BuildJobState } from '../hooks/useBuildJob'
import { copyText, formatClock } from '../lib/format'
import type { BuildOptions, OutputEntry } from '../types'
import { ResultPanel } from './ResultPanel'

type BuildPanelProps = {
  presetName: string
  dirty: number
  build: BuildJobState
}

type TriState = '' | 'on' | 'off'
const TRI_FLAGS: Array<{ key: keyof BuildOptions; label: string }> = [
  { key: 'cards', label: 'cards' },
  { key: 'bgm', label: 'bgm' },
  { key: 'zoom', label: 'zoom' },
  { key: 'enhance', label: 'enhance' },
  { key: 'avoidFace', label: 'avoid-face' },
  { key: 'title', label: 'title' },
  { key: 'date', label: 'date' },
  { key: 'serif', label: 'serif' },
  { key: 'time', label: 'time' },
  { key: 'progress', label: 'progress' },
  { key: 'opening', label: 'opening' },
  { key: 'ending', label: 'ending' },
]
const STAGE_LABELS: Record<string, string> = {
  render: '描画',
  concat: '連結',
  bgm: 'BGM',
  manifest: 'manifest',
  summary: '概要欄',
  qc: 'QC',
}

export function BuildPanel({ presetName, dirty, build }: BuildPanelProps) {
  const [options, setOptions] = useState<BuildOptions>({})
  const [outputs, setOutputs] = useState<OutputEntry[]>([])
  const [selectedBase, setSelectedBase] = useState<string | null>(null)
  const [resultKey, setResultKey] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const job = build.job
  const running = job?.state === 'running'
  const presetBase = presetName.replace(/\.json$/u, '')

  // 実行中は 1 秒ごとに経過時間を進める
  useEffect(() => {
    if (!running) {
      return undefined
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // 完了したら出力一覧を読み直し、その結果を選択する
  const doneJobId = job && job.state !== 'running' ? job.id : null
  useEffect(() => {
    let ignore = false
    void listOutputs()
      .then((list) => {
        if (ignore) {
          return
        }
        setOutputs(list)
        setResultKey((value) => value + 1)
        setSelectedBase((current) => job?.outBase ?? current ?? list[0]?.base ?? null)
      })
      .catch(() => undefined)
    return () => {
      ignore = true
    }
    // job の完了（doneJobId の変化）と初回だけ読み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneJobId])

  const commandPreview = useMemo(() => previewCommand(presetName, options), [options, presetName])
  const elapsedSec = job ? ((job.endedAt ?? now) - job.startedAt) / 1000 : 0
  const progressRatio = job?.progress ? job.progress.i / Math.max(1, job.progress.n) : job?.state === 'done' ? 1 : 0

  const setTri = (key: keyof BuildOptions, value: TriState) => {
    setOptions((current) => {
      const next = { ...current }
      if (value === '') {
        delete next[key]
      } else {
        (next as Record<string, unknown>)[key] = value === 'on'
      }
      return next
    })
  }

  return (
    <div className="cv-build">
      <section className="cv-buildOptions">
        <div className="cv-controlRow">
          <span className="cv-controlLabel">プリセット</span>
          <code>{presetName}</code>
          {dirty > 0 ? <span className="cv-alert is-warning cv-inlineAlert">未保存の変更が {dirty} 件あります。ビルドは保存済みの内容で走ります</span> : null}
        </div>
        <div className="cv-controlRow">
          <label className="cv-inlineField">
            <span>--limit</span>
            <input
              className="cv-input cv-inputShort"
              type="number"
              min={1}
              max={999}
              value={options.limit ?? ''}
              onChange={(event) => setOptions((current) => ({ ...current, limit: event.target.value === '' ? undefined : Number(event.target.value) }))}
            />
          </label>
          <label className="cv-toggle">
            <input type="checkbox" checked={options.qc === true || options.contact === true} onChange={(event) => setOptions((current) => ({ ...current, qc: event.target.checked || undefined }))} />
            <span>--qc</span>
          </label>
          <label className="cv-toggle">
            <input type="checkbox" checked={options.contact === true} onChange={(event) => setOptions((current) => ({ ...current, contact: event.target.checked || undefined }))} />
            <span>--contact</span>
          </label>
          <label className="cv-inlineField">
            <span>--source</span>
            <select className="cv-select" value={options.source ?? ''} onChange={(event) => setOptions((current) => ({ ...current, source: (event.target.value || undefined) as BuildOptions['source'] }))}>
              <option value="">（プリセットのまま）</option>
              <option value="existing">existing</option>
              <option value="cache">cache</option>
            </select>
          </label>
          <label className="cv-inlineField">
            <span>--out</span>
            <input
              className="cv-input"
              type="text"
              placeholder="output/ 直下のファイル名.mp4"
              value={options.out ?? ''}
              onChange={(event) => setOptions((current) => ({ ...current, out: event.target.value || undefined }))}
            />
          </label>
        </div>
        <div className="cv-controlRow cv-triRow">
          {TRI_FLAGS.map((flag) => {
            const value = options[flag.key]
            const tri: TriState = value === true ? 'on' : value === false ? 'off' : ''
            return (
              <label className="cv-inlineField" key={flag.key}>
                <span>--{flag.label}</span>
                <select className="cv-select cv-selectTri" value={tri} onChange={(event) => setTri(flag.key, event.target.value as TriState)}>
                  <option value="">継承</option>
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </label>
            )
          })}
        </div>
        <div className="cv-controlRow">
          <code className="cv-command">{commandPreview}</code>
          <button type="button" className="cv-button cv-buttonSmall" onClick={() => void copyText(commandPreview)}>
            コピー
          </button>
        </div>
        <div className="cv-controlRow">
          <button
            type="button"
            className="cv-button cv-buttonPrimary"
            onClick={() => void build.start(presetName, options)}
            disabled={!presetName || dirty > 0 || running}
            title={dirty > 0 ? '保存してからビルドしてください' : ''}
          >
            ▶ ビルド開始
          </button>
          <button type="button" className="cv-button" onClick={() => void build.cancel()} disabled={!running}>
            ■ キャンセル
          </button>
          {job ? (
            <span className={`cv-statusBadge is-${job.state === 'done' ? 'ok' : job.state === 'running' ? 'muted' : 'error'}`}>
              {job.kind} {job.state}
              {job.exitCode !== null ? ` (exit ${job.exitCode})` : ''}
            </span>
          ) : null}
          {build.error ? <span className="cv-alert is-error cv-inlineAlert">{build.error}</span> : null}
        </div>
      </section>

      {job ? (
        <section className="cv-buildProgress">
          <div className="cv-progressBar" role="progressbar" aria-valuenow={Math.round(progressRatio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="cv-progressFill" style={{ width: `${Math.round(progressRatio * 100)}%` }} />
          </div>
          <div className="cv-progressMeta">
            <span>
              {job.progress ? `${job.progress.i}/${job.progress.n} ${job.progress.base}` : ''}
              {job.stage ? ` · 段階: ${STAGE_LABELS[job.stage] ?? job.stage}` : ''}
            </span>
            <span>
              経過 {formatClock(elapsedSec)}
              {job.qc ? ` · QC error ${job.qc.error} / warn ${job.qc.warn} / info ${job.qc.info}` : ''}
              {job.concat ? ` · ${job.concat}` : ''}
            </span>
          </div>
        </section>
      ) : null}

      <LogConsole build={build} presetBase={presetBase} />

      <section className="cv-buildResult">
        <div className="cv-sectionHeader">
          <h2>結果</h2>
          <select className="cv-select" value={selectedBase ?? ''} onChange={(event) => setSelectedBase(event.target.value || null)}>
            {outputs.length === 0 ? <option value="">（出力なし）</option> : null}
            {outputs.map((entry) => (
              <option key={entry.base} value={entry.base}>
                {entry.base}
              </option>
            ))}
          </select>
        </div>
        <ResultPanel base={selectedBase} refreshKey={resultKey} busy={running} onRunQc={(contact) => selectedBase && void build.runQc(presetName, selectedBase, contact)} />
      </section>
    </div>
  )
}

function LogConsole({ build, presetBase }: { build: BuildJobState; presetBase: string }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const logs = build.logs

  useEffect(() => {
    const element = preRef.current
    if (element && autoScroll) {
      element.scrollTop = element.scrollHeight
    }
  }, [autoScroll, logs])

  const onScroll = () => {
    const element = preRef.current
    if (!element) {
      return
    }
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    if (atBottom !== autoScroll) {
      setAutoScroll(atBottom)
    }
  }

  return (
    <section className="cv-log">
      <div className="cv-sectionHeader">
        <h2>ログ {build.connected ? <span className="cv-hint">（接続中）</span> : null}</h2>
        <div className="cv-settingsTools">
          <label className="cv-toggle">
            <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
            <span>自動スクロール</span>
          </label>
          <button type="button" className="cv-button cv-buttonSmall" onClick={() => void copyText(logs.map((line) => line.text).join('\n'))} disabled={logs.length === 0}>
            コピー
          </button>
          <a className="cv-button cv-buttonSmall" href={fileUrl('log', presetBase)} target="_blank" rel="noreferrer">
            ログファイル
          </a>
          <button type="button" className="cv-button cv-buttonSmall" onClick={build.clear} disabled={!build.job || build.job.state === 'running'}>
            クリア
          </button>
        </div>
      </div>
      <pre className="cv-logConsole" ref={preRef} onScroll={onScroll} aria-live="polite">
        {logs.length === 0 ? <span className="cv-hint">ログはまだありません</span> : null}
        {logs.map((line) => (
          <span key={line.n} className={line.stream === 'err' ? 'cv-logLine is-err' : 'cv-logLine'}>
            {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
    </section>
  )
}

// サーバの buildArgv と同じ順で argv を組み、等価コマンドとして見せる（実際の argv はサーバ側で確定する）。
function previewCommand(presetName: string, options: BuildOptions): string {
  const argv = ['node', 'scripts/create-video/index.js', '--config', `scripts/create-video/${presetName}`]
  if (options.limit) {
    argv.push('--limit', String(options.limit))
  }
  if (options.qc || options.contact) {
    argv.push('--qc')
  }
  if (options.contact) {
    argv.push('--contact')
  }
  if (options.source) {
    argv.push('--source', options.source)
  }
  for (const flag of TRI_FLAGS) {
    const value = options[flag.key]
    if (value === true) {
      argv.push(`--${flag.label}`)
    } else if (value === false) {
      argv.push(`--no-${flag.label}`)
    }
  }
  if (options.titleText) {
    argv.push('--title', JSON.stringify(options.titleText))
  }
  if (options.resolution) {
    argv.push('--resolution', options.resolution)
  }
  if (options.out) {
    argv.push('--out', `output/${options.out}`)
  }
  return argv.join(' ')
}
