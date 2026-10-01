import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelJob, getJob, jobLogUrl, startBuild, startQc } from '../api'
import type { BuildOptions, JobSummary, LogEvent } from '../types'

const MAX_LOG_LINES = 5000

export type BuildJobState = {
  job: JobSummary | null
  logs: LogEvent[]
  connected: boolean
  error: string
  start(name: string, options: BuildOptions): Promise<void>
  runQc(name: string, video: string, contact: boolean): Promise<void>
  cancel(): Promise<void>
  attach(jobId: string): Promise<void>
  clear(): void
}

// ビルド / QC ジョブの状態と SSE ログ。EventSource は自動再接続し、Last-Event-ID で続きから受け取る。
export function useBuildJob(onJobChange?: (jobId: string | null) => void): BuildJobState {
  const [job, setJob] = useState<JobSummary | null>(null)
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const sourceRef = useRef<EventSource | null>(null)

  const closeSource = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setConnected(false)
  }, [])

  const subscribe = useCallback((jobId: string) => {
    closeSource()
    const source = new EventSource(jobLogUrl(jobId))
    sourceRef.current = source
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.addEventListener('started', (event) => {
      setJob(JSON.parse((event as MessageEvent<string>).data) as JobSummary)
    })
    source.addEventListener('log', (event) => {
      const entry = JSON.parse((event as MessageEvent<string>).data) as LogEvent
      setLogs((current) => {
        if (current.some((line) => line.n === entry.n)) {
          return current
        }
        const next = [...current, entry]
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
      })
    })
    source.addEventListener('progress', (event) => {
      const progress = JSON.parse((event as MessageEvent<string>).data) as JobSummary['progress']
      setJob((current) => (current ? { ...current, progress, stage: 'render' } : current))
    })
    source.addEventListener('stage', (event) => {
      const { name } = JSON.parse((event as MessageEvent<string>).data) as { name: string }
      setJob((current) => (current ? { ...current, stage: name } : current))
    })
    source.addEventListener('done', (event) => {
      setJob(JSON.parse((event as MessageEvent<string>).data) as JobSummary)
      // 完了後に EventSource を開いたままにすると自動再接続で再送を繰り返すので閉じる
      source.close()
      sourceRef.current = null
      setConnected(false)
    })
    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent<string>).data
      if (typeof data === 'string') {
        const payload = JSON.parse(data) as { message: string }
        setError(payload.message)
      }
    })
  }, [closeSource])

  const begin = useCallback((summary: JobSummary) => {
    setLogs([])
    setError('')
    setJob(summary)
    onJobChange?.(summary.id)
    subscribe(summary.id)
  }, [onJobChange, subscribe])

  const start = useCallback(async (name: string, options: BuildOptions) => {
    setError('')
    try {
      begin(await startBuild(name, options))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [begin])

  const runQc = useCallback(async (name: string, video: string, contact: boolean) => {
    setError('')
    try {
      begin(await startQc(name, video, contact))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [begin])

  const cancel = useCallback(async () => {
    if (!job) {
      return
    }
    try {
      await cancelJob(job.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [job])

  // ページ再読込後に session の jobId から復帰する。実行中なら SSE を since=0 で購読し直す。
  const attach = useCallback(async (jobId: string) => {
    try {
      const summary = await getJob(jobId)
      setJob(summary)
      setLogs([])
      subscribe(summary.id)
    } catch {
      onJobChange?.(null)
    }
  }, [onJobChange, subscribe])

  const clear = useCallback(() => {
    closeSource()
    setJob(null)
    setLogs([])
    setError('')
    onJobChange?.(null)
  }, [closeSource, onJobChange])

  useEffect(() => () => closeSource(), [closeSource])

  return { job, logs, connected, error, start, runQc, cancel, attach, clear }
}
