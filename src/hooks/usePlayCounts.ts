import { useEffect, useState } from 'react'
import { subscribePerClipCounts, subscribePlayCount } from '../lib/playCount'

// 総再生数・クリップ別再生数の購読をまとめたフック。
export function usePlayCounts() {
  const [totalPlays, setTotalPlays] = useState<number | null>(null)
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    const unsubscribeTotal = subscribePlayCount(setTotalPlays)
    const unsubscribePerClip = subscribePerClipCounts(setPlayCounts)
    return () => {
      unsubscribeTotal()
      unsubscribePerClip()
    }
  }, [])

  return { totalPlays, playCounts }
}
