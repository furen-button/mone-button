import { useCallback, useMemo, useState } from 'react'
import {
  voiceClips,
  type SortType,
  type StreamGroup,
  type VoiceData,
} from '../voiceData'

type UseClipCollectionArgs = {
  selectedCategories: string[]
  sortType: SortType
  playCounts: Record<string, number>
}

// クリップ一覧の派生（dev 編集の override マージ・カテゴリ絞り込み・並び替え・
// ストリームグループ化・インデックスマップ）をまとめたフック。
export function useClipCollection({ selectedCategories, sortType, playCounts }: UseClipCollectionArgs) {
  const [clipOverrides, setClipOverrides] = useState<Record<string, VoiceData>>({})

  // dev 編集で保存した内容をその場で反映するため、voiceClips に override をマージした一覧を使う。
  const clips = useMemo(
    () =>
      voiceClips.map((clip) => {
        const override = clipOverrides[clip.fileBaseName]
        return override ? { ...clip, ...override } : clip
      }),
    [clipOverrides],
  )

  const visibleClips = useMemo(
    () => clips.filter((clip) => clip.categories.some((category) => selectedCategories.includes(category))),
    [clips, selectedCategories],
  )

  const sortedClips = useMemo(() => {
    const sorted = [...visibleClips]

    if (sortType === 'reading') {
      return sorted.sort((a, b) => a.ruby.localeCompare(b.ruby, 'ja'))
    }

    if (sortType === 'play-count') {
      return sorted.sort((a, b) => {
        const countDiff = (playCounts[b.fileBaseName] ?? 0) - (playCounts[a.fileBaseName] ?? 0)
        if (countDiff !== 0) {
          return countDiff
        }

        return a.ruby.localeCompare(b.ruby, 'ja')
      })
    }

    const direction = sortType === 'stream-desc' ? -1 : 1
    return sorted.sort((a, b) => {
      const dateA = a.videoFile.metadata.uploadDate
      const dateB = b.videoFile.metadata.uploadDate

      if (dateA !== dateB) {
        return dateA > dateB ? direction : -direction
      }

      if (a.videoId !== b.videoId) {
        return a.videoId.localeCompare(b.videoId, 'ja')
      }

      const startTimeDiff = a.trimming.startTime - b.trimming.startTime
      if (startTimeDiff !== 0) {
        return startTimeDiff
      }

      return a.serif.localeCompare(b.serif, 'ja')
    })
  }, [sortType, visibleClips, playCounts])

  const streamGroups = useMemo(() => {
    if (sortType !== 'stream-desc' && sortType !== 'stream-asc') {
      return []
    }

    return sortedClips.reduce<StreamGroup[]>((groups, clip) => {
      const key = clip.videoId
      const lastGroup = groups[groups.length - 1]

      if (lastGroup && lastGroup.key === key) {
        lastGroup.clips.push(clip)
        return groups
      }

      groups.push({
        key,
        title: clip.videoFile.metadata.title,
        uploadDate: clip.videoFile.metadata.uploadDate,
        url: clip.videoFile.metadata.url,
        clips: [clip],
      })
      return groups
    }, [])
  }, [sortType, sortedClips])

  const clipIndexMap = useMemo(
    () => new Map(sortedClips.map((clip, index) => [clip.fileBaseName, index])),
    [sortedClips],
  )

  const applyClipOverride = useCallback((fileBaseName: string, updated: VoiceData) => {
    setClipOverrides((current) => ({ ...current, [fileBaseName]: updated }))
  }, [])

  return { sortedClips, streamGroups, clipIndexMap, applyClipOverride }
}
