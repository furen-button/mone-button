import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchVideoStatus } from '../lib/devDataEditor'

// dev 限定: public/videos にある mp4 の一覧を持ち、カードの「未DL」バッジの元にする。
// 起動時と、タブに戻ってきたとき（別ターミナルで npm run download した直後を拾う）と、
// 呼び出し側が refreshVideos したとき（編集モーダルを閉じた・削除した）に取り直す。
// enabled が false（本番ビルド）のときは何もせず videos は undefined のまま。
export function useDevVideoStatus(enabled: boolean) {
  const [videos, setVideos] = useState<ReadonlySet<string> | undefined>(undefined)
  const requestRef = useRef<AbortController | null>(null)

  const refreshVideos = useCallback(() => {
    if (!enabled) {
      return
    }
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    fetchVideoStatus(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setVideos(next)
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('動画一覧の取得に失敗しました', error)
        }
      })
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      return
    }
    refreshVideos()
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshVideos()
      }
    }
    window.addEventListener('focus', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    const request = requestRef
    return () => {
      window.removeEventListener('focus', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
      request.current?.abort()
    }
  }, [enabled, refreshVideos])

  return { videos, refreshVideos }
}
