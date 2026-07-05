import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  trackPlaybackStart,
  trackSequentialAdvance,
  trackSequentialToggle,
  type PlaybackStartSource,
} from '../lib/analytics'
import { incrementPlayCount } from '../lib/playCount'
import { type FloatingStageClip, type PlaybackMode, type VoiceClip } from '../voiceData'

type UsePlaybackArgs = {
  sortedClips: VoiceClip[]
  clipIndexMap: Map<string, number>
  appShellRef: RefObject<HTMLElement | null>
}

// 再生エンジン（フローティングクリップの生成/除去・単発/ランダム/がらがや/連続再生・
// 停止アニメーション）をまとめたフック。
export function usePlayback({ sortedClips, clipIndexMap, appShellRef }: UsePlaybackArgs) {
  const [floatingClips, setFloatingClips] = useState<FloatingStageClip[]>([])
  const [isStopping, setIsStopping] = useState(false)
  const [sparkKey, setSparkKey] = useState(0)
  const [garageyaKey, setGarageyaKey] = useState(0)
  const [isSequentialMode, setIsSequentialMode] = useState(false)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('single')
  const stopTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current)
      }
    }
  }, [])

  const cancelStopAnimation = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }

    setIsStopping(false)
  }, [])

  const createFloatingClip = useCallback(
    (nextClip: VoiceClip, width: number) => {
      const shellWidth = appShellRef.current?.clientWidth ?? Math.min(window.innerWidth, 700)
      const viewportHeight = window.innerHeight
      const safeSidePadding = 20
      const safeTopPadding = 84
      const safeBottomPadding = 140
      const clampedWidth = Math.min(width, Math.max(shellWidth - safeSidePadding * 2, 220))

      const cardHeight = Math.round(clampedWidth * 0.6)
      const maxX = Math.max(shellWidth - clampedWidth - safeSidePadding * 2, 0)
      const maxY = Math.max(viewportHeight - cardHeight - safeTopPadding - safeBottomPadding, 0)

      return {
        id: `${nextClip.fileBaseName}-${Math.random().toString(36).slice(2, 8)}`,
        clip: nextClip,
        left: safeSidePadding + Math.random() * maxX,
        top: safeTopPadding + Math.random() * maxY,
        width: clampedWidth,
      }
    },
    [appShellRef],
  )

  const getRandomClip = useCallback(
    (excludeFileBaseName?: string) => {
      const candidates = excludeFileBaseName
        ? sortedClips.filter((clip) => clip.fileBaseName !== excludeFileBaseName)
        : sortedClips

      if (candidates.length === 0) {
        return null
      }

      return candidates[Math.floor(Math.random() * candidates.length)]
    },
    [sortedClips],
  )

  const playClipAtIndex = useCallback(
    (index: number, sourceAction: PlaybackStartSource = 'voice_card', replaceCurrent = false) => {
      if (sortedClips.length === 0) {
        return
      }

      cancelStopAnimation()

      const normalized = ((index % sortedClips.length) + sortedClips.length) % sortedClips.length
      const nextClip = sortedClips[normalized]

      trackPlaybackStart(nextClip, 'single', sourceAction)
      incrementPlayCount(nextClip.fileBaseName)
      setFloatingClips((current) => {
        const nextFloatingClip = createFloatingClip(nextClip, 320)
        return replaceCurrent ? [nextFloatingClip] : [...current, nextFloatingClip]
      })
      setPlaybackMode('single')
      setSparkKey((prev) => prev + 1)
    },
    [cancelStopAnimation, createFloatingClip, sortedClips],
  )

  const playClip = useCallback(
    (nextClip: VoiceClip) => {
      const index = clipIndexMap.get(nextClip.fileBaseName) ?? 0
      playClipAtIndex(index, 'voice_card')
    },
    [clipIndexMap, playClipAtIndex],
  )

  const playRandom = useCallback(() => {
    if (sortedClips.length === 0) {
      return
    }

    const randomIndex = Math.floor(Math.random() * sortedClips.length)
    playClipAtIndex(randomIndex, 'random_button')
  }, [playClipAtIndex, sortedClips])

  const playGarageya = useCallback(() => {
    if (sortedClips.length === 0) {
      return
    }

    for (let i = 0; i < 4; i += 1) {
      const randomIndex = Math.floor(Math.random() * sortedClips.length)
      playClipAtIndex(randomIndex, 'garageya_button')
    }

    setGarageyaKey((prev) => prev + 1)
  }, [playClipAtIndex, sortedClips])

  const handleSequentialEnded = useCallback(
    (endedClipId?: string) => {
      if (!endedClipId) {
        return
      }

      setFloatingClips((currentClips) => {
        const endedClip = currentClips.find((clip) => clip.id === endedClipId)

        // Ignore duplicated ended notifications for already-removed clips.
        if (!endedClip) {
          return currentClips
        }

        const remainingClips = currentClips.filter((clip) => clip.id !== endedClipId)

        if (!isSequentialMode || sortedClips.length === 0) {
          return remainingClips
        }

        const nextClip = getRandomClip(endedClip?.clip.fileBaseName)
        if (!nextClip) {
          return remainingClips
        }

        trackSequentialAdvance(playbackMode, endedClip?.clip.fileBaseName ?? '', nextClip.fileBaseName)
        trackPlaybackStart(
          nextClip,
          playbackMode,
          playbackMode === 'garageya' ? 'sequential_garageya' : 'sequential_single',
        )
        incrementPlayCount(nextClip.fileBaseName)

        return [...remainingClips, createFloatingClip(nextClip, 320)]
      })
    },
    [createFloatingClip, getRandomClip, isSequentialMode, playbackMode, sortedClips.length],
  )

  const handleToastClose = useCallback((clipId: string) => {
    setFloatingClips((currentClips) => currentClips.filter((clip) => clip.id !== clipId))
  }, [])

  const stop = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
    }

    const videos = appShellRef.current?.querySelectorAll('video') ?? []
    videos.forEach((video) => {
      video.pause()
      video.currentTime = 0
    })

    setIsSequentialMode(false)
    setPlaybackMode('single')
    setIsStopping(true)

    stopTimerRef.current = window.setTimeout(() => {
      setFloatingClips([])
      setIsStopping(false)
      stopTimerRef.current = null
    }, 180)
  }, [appShellRef])

  const toggleSequential = useCallback(() => {
    setIsSequentialMode((prev) => {
      const nextValue = !prev
      trackSequentialToggle(nextValue, playbackMode)
      return nextValue
    })
  }, [playbackMode])

  return {
    floatingClips,
    isStopping,
    sparkKey,
    garageyaKey,
    isSequentialMode,
    playClip,
    playRandom,
    playGarageya,
    stop,
    toggleSequential,
    handleSequentialEnded,
    handleToastClose,
  }
}
