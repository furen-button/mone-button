import { useCallback, useMemo, useState } from 'react'
import {
  buildSameSerifLabels,
  voiceClips,
  withDisplaySerif,
  type SortType,
  type StreamGroup,
  type VoiceClip,
  type VoiceData,
} from '../voiceData'
import { withVideoCacheBust } from '../lib/videoPath'
import { reviewClip } from '../../scripts/dev-server/lib/clip-review.js'
import type { ClipIssueKind, ClipReviewResult } from '../../scripts/dev-server/lib/clip-review.js'

// 配信順（日付 → videoId → 開始秒）で比べる。direction は日付の向き。
// 同じ日の中は常に昇順なので、同じ serif のボタンは buildSameSerifLabels の No の順に並ぶ。
const compareByStream = (a: VoiceClip, b: VoiceClip, direction = 1): number => {
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
}

// dev 限定の要対応判定の入力。本番ビルドでは渡さない（判定もしない）。
export type ReviewOptions = {
  // public/videos にある mp4。undefined は未取得で、動画の有無は判定しない。
  videos: ReadonlySet<string> | undefined
  // 要対応の種類で絞る。null なら絞らない。絞っている間はカテゴリの選択を無視する。
  filter: ReadonlySet<ClipIssueKind> | null
}

type UseClipCollectionArgs = {
  selectedCategories: string[]
  sortType: SortType
  playCounts: Record<string, number>
  videoVersions: Record<string, number>
  review?: ReviewOptions
}

// クリップ一覧の派生（dev 編集の override マージ・要対応判定・カテゴリ絞り込み・並び替え・
// ストリームグループ化・インデックスマップ）をまとめたフック。
export function useClipCollection({ selectedCategories, sortType, playCounts, videoVersions, review }: UseClipCollectionArgs) {
  const [clipOverrides, setClipOverrides] = useState<Record<string, VoiceData>>({})
  const [deletedClips, setDeletedClips] = useState<ReadonlySet<string>>(() => new Set())

  // dev 編集で保存・削除した内容をその場で反映するため、voiceClips に override をマージし削除分を除いた一覧を使う。
  const clips = useMemo(
    () =>
      voiceClips
        .filter((clip) => !deletedClips.has(clip.fileBaseName))
        .map((clip) => {
          const override = clipOverrides[clip.fileBaseName]
          const videoPath = withVideoCacheBust(clip.videoPath, videoVersions[clip.fileBaseName])
          return override
            ? { ...clip, ...withDisplaySerif(override), videoPath }
            : { ...clip, videoPath }
        }),
    [clipOverrides, deletedClips, videoVersions],
  )

  // 番号が絞り込みで変わらないよう、カテゴリで絞る前の全クリップで振る。
  const sameSerifLabels = useMemo(() => buildSameSerifLabels(clips), [clips])

  // dev 限定: 全クリップの要対応。serif は JSON の生の値で判定する
  // （改行を区切りとして数え、「このままで良い」の記録とも生の値で比べる）。
  const reviews = useMemo(() => {
    if (!review) {
      return undefined
    }
    const videos = review.videos
    return new Map<string, ClipReviewResult>(
      clips.map((clip) => [
        clip.fileBaseName,
        reviewClip({ ...clip, serif: clip.rawSerif }, { hasVideo: videos ? videos.has(clip.fileBaseName) : undefined }),
      ]),
    )
  }, [clips, review])

  const issueFilter = review?.filter ?? null

  const visibleClips = useMemo(() => {
    if (issueFilter && reviews) {
      return clips.filter((clip) =>
        (reviews.get(clip.fileBaseName)?.issues ?? []).some((issue) => issueFilter.has(issue.kind)),
      )
    }
    return clips.filter((clip) => clip.categories.some((category) => selectedCategories.includes(category)))
  }, [clips, issueFilter, reviews, selectedCategories])

  const sortedClips = useMemo(() => {
    const sorted = [...visibleClips]

    // 読みが同じボタン（「あいさつ」など）は配信順に並べ、同じ日の No が前後しないようにする。
    if (sortType === 'reading') {
      return sorted.sort((a, b) => a.ruby.localeCompare(b.ruby, 'ja') || compareByStream(a, b))
    }

    if (sortType === 'play-count') {
      return sorted.sort((a, b) => {
        const countDiff = (playCounts[b.fileBaseName] ?? 0) - (playCounts[a.fileBaseName] ?? 0)
        if (countDiff !== 0) {
          return countDiff
        }

        return a.ruby.localeCompare(b.ruby, 'ja') || compareByStream(a, b)
      })
    }

    const direction = sortType === 'stream-desc' ? -1 : 1
    return sorted.sort((a, b) => compareByStream(a, b, direction))
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

  const removeClip = useCallback((fileBaseName: string) => {
    setDeletedClips((current) => new Set(current).add(fileBaseName))
  }, [])

  return {
    sortedClips,
    streamGroups,
    clipIndexMap,
    sameSerifLabels,
    reviews,
    totalClipCount: clips.length,
    applyClipOverride,
    removeClip,
  }
}
