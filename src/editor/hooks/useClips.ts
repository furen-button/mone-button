import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchClips } from '../api'
import type { ClipsResponse, JsonObject } from '../types'

export type ClipsState = {
  state: 'idle' | 'pending' | 'ok' | 'error'
  response: ClipsResponse | null
  error: string
  reload(): void
}

// draft.select の変化だけを見て /__cv/clips を呼ぶ。テロップなど他の項目を触っても一覧は変わらないので再取得しない。
export function useClips(draft: JsonObject, enabled: boolean): ClipsState {
  const [response, setResponse] = useState<ClipsResponse | null>(null)
  const [state, setState] = useState<ClipsState['state']>('idle')
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const selectKey = useMemo(() => JSON.stringify(draft.select ?? null), [draft.select])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState('pending')
      void fetchClips(draft, controller.signal)
        .then((next) => {
          setResponse(next)
          setState('ok')
          setError('')
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) {
            return
          }
          setState('error')
          setError(cause instanceof Error ? cause.message : String(cause))
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // selectKey が draft.select の同一性を表す。draft 全体を依存にすると無関係な編集で再取得してしまう。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectKey, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { state, response, error, reload }
}
