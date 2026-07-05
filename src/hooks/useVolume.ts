import { useEffect, useState, type RefObject } from 'react'
import { VOLUME_STORAGE_KEY, type FloatingStageClip } from '../voiceData'

// 音量の状態・永続化・再生中 <video> への適用をまとめたフック。
// floatingClips を依存に取り、新しいクリップが mount されたタイミングで音量を再適用する。
export function useVolume(
  appShellRef: RefObject<HTMLElement | null>,
  floatingClips: FloatingStageClip[],
) {
  const [volume, setVolume] = useState<number>(() => {
    const saved = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (!saved) {
      return 0.7
    }

    const parsed = Number(saved)
    if (Number.isNaN(parsed)) {
      return 0.7
    }

    return Math.min(1, Math.max(0, parsed))
  })

  useEffect(() => {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
    const videos = appShellRef.current?.querySelectorAll('video') ?? []
    videos.forEach((video) => {
      video.volume = volume
    })
  }, [volume, floatingClips, appShellRef])

  return { volume, setVolume }
}
