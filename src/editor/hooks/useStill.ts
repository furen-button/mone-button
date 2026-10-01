import { useEffect, useState } from 'react'
import { renderStillImage } from '../api'
import type { StillMeta, StillRequest } from '../types'

export type StillState = {
  state: 'idle' | 'pending' | 'ok' | 'error'
  url: string | null
  meta: StillMeta | null
  error: string
}

type CacheEntry = { url: string; meta: StillMeta }

const CACHE_LIMIT = 30
const DEBOUNCE_MS = 250

// blob URL の LRU。モジュールレベルに置くのは、タブを切り替えて戻ってもキャッシュが残るようにするためと、
// render 中に ref を読まずに済ませるため（同じ要求はサーバ往復なしで即表示）。
const stillCache = new Map<string, CacheEntry>()

function readCache(key: string): CacheEntry | undefined {
  const entry = stillCache.get(key)
  if (entry) {
    stillCache.delete(key)
    stillCache.set(key, entry)
  }
  return entry
}

function writeCache(key: string, entry: CacheEntry): void {
  stillCache.set(key, entry)
  while (stillCache.size > CACHE_LIMIT) {
    const oldestKey = stillCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    const oldest = stillCache.get(oldestKey)
    stillCache.delete(oldestKey)
    if (oldest) {
      URL.revokeObjectURL(oldest.url)
    }
  }
}

// 250ms デバウンスで /__cv/still を呼び、前のリクエストは AbortController で止める（サーバ側の ffmpeg も止まる）。
// pending 中は直前に表示していた画像を残して点滅させない。
export function useStill(request: StillRequest | null): StillState {
  const requestKey = request ? JSON.stringify(request) : null
  const [fetched, setFetched] = useState<{ key: string; entry: CacheEntry } | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    if (!requestKey || !request || stillCache.has(requestKey)) {
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPendingKey(requestKey)
      void renderStillImage(request, controller.signal)
        .then(({ blob, meta }) => {
          const entry = { url: URL.createObjectURL(blob), meta }
          writeCache(requestKey, entry)
          setFetched({ key: requestKey, entry })
          setPendingKey((current) => (current === requestKey ? null : current))
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) {
            return
          }
          setError({ key: requestKey, message: cause instanceof Error ? cause.message : String(cause) })
          setPendingKey((current) => (current === requestKey ? null : current))
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // requestKey が request の内容を表す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  if (!requestKey) {
    return { state: 'idle', url: null, meta: null, error: '' }
  }

  const cached = readCache(requestKey)
  if (cached) {
    return { state: 'ok', url: cached.url, meta: cached.meta, error: '' }
  }

  // 未取得: 直前の画像を出したまま pending / error を伝える
  const previous = fetched?.entry ?? null
  if (error?.key === requestKey) {
    return { state: 'error', url: previous?.url ?? null, meta: previous?.meta ?? null, error: error.message }
  }
  // デバウンス待ちも取得中も、表示上は同じ「更新中」扱い
  void pendingKey
  return { state: 'pending', url: previous?.url ?? null, meta: previous?.meta ?? null, error: '' }
}
