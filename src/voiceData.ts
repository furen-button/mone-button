export interface ClipZoomEffect {
  mode?: 'punch' | 'full'
  at?: number
  scale?: number
  x?: number
  y?: number
}

export interface ClipEffects {
  zoom?: boolean | ClipZoomEffect
}

export interface VoiceData {
  videoId: string
  serif: string
  ruby: string
  categories: string[]
  clipUrl: string
  memo: string
  effects?: ClipEffects
  trimming: {
    startTime: number
    endTime: number
    duration: number
    original?: {
      startTime: number
      endTime: number
      duration: number
    }
  }
  videoFile: {
    metadata: {
      videoId: string
      title: string
      duration: number
      thumbnail: string
      uploader: string
      uploadDate: string
      viewCount: number
      url: string
    }
  }
}

export interface VoiceClip extends VoiceData {
  fileBaseName: string
  videoPath: string
  // public/data の serif そのまま（改行・強調記法を含む）。serif は表示用に正規化したもの。
  rawSerif: string
}

export interface StreamGroup {
  key: string
  title: string
  uploadDate: string
  url: string
  clips: VoiceClip[]
}

export interface FloatingStageClip {
  id: string
  clip: VoiceClip
  left: number
  top: number
  width: number
}

export interface WaiwaiSlot {
  x: number
  y: number
  width: number
}

export type SortType = 'reading' | 'stream-desc' | 'stream-asc' | 'play-count'
export type PlaybackMode = 'single' | 'waiwai'

const dataModules = import.meta.glob<VoiceData>('../public/data/*.json', {
  eager: true,
  import: 'default',
})

const baseUrl = import.meta.env.BASE_URL

// serif の改行はまとめ動画のテロップ専用なので、サイトでは語中を詰め、元の空白区切りは残す。
// 強調記法も記号だけ落とす（scripts/create-video/ass.js の parseEmphasis と同じ規則）。
export const normalizeSerifForDisplay = (serif: string): string =>
  serif
    .replace(
      /[^\S\r\n]*\r?\n[^\S\r\n]*/g,
      (matched) => (/[^\S\r\n]/.test(matched) ? ' ' : ''),
    )
    .replace(/\{([^{}|]+)(?:\|[0-9A-Fa-f]{6})?\}/g, '$1')

// public/data の内容を一覧・モーダル用に整える。serif は表示用に正規化し、編集で書き戻せるよう
// 元の文字列を rawSerif に残す。初期ロードと dev 保存の反映の両方でこれを通す。
export const withDisplaySerif = <T extends VoiceData>(data: T): T & { rawSerif: string } => ({
  ...data,
  serif: normalizeSerifForDisplay(data.serif),
  rawSerif: data.serif,
})

export const voiceClips: VoiceClip[] = Object.entries(dataModules)
  .map(([path, data]) => {
    const filename = path.split('/').pop()
    if (!filename) {
      return null
    }

    const fileBaseName = filename.replace(/\.json$/i, '')
    return {
      ...withDisplaySerif(data),
      fileBaseName,
      videoPath: `${baseUrl}videos/${fileBaseName}.mp4`,
    }
  })
  .filter((clip): clip is VoiceClip => clip !== null)

export const categoryOptions = Array.from(
  new Set(voiceClips.flatMap((clip) => clip.categories)),
).sort((a, b) => a.localeCompare(b, 'ja'))

export const categoryCounts = voiceClips.reduce<Record<string, number>>((counts, clip) => {
  clip.categories.forEach((category) => {
    counts[category] = (counts[category] ?? 0) + 1
  })
  return counts
}, {})

export const WAIWAI_PATTERNS: WaiwaiSlot[][] = [
  [
    { x: 1 / 8, y: 1 / 8, width: 0.26 },
    { x: 5 / 8, y: 1 / 4, width: 0.24 },
    { x: 2 / 8, y: 5 / 8, width: 0.27 },
    { x: 7 / 8, y: 7 / 8, width: 0.23 },
  ],
  [
    { x: 1 / 6, y: 1 / 5, width: 0.24 },
    { x: 4 / 6, y: 1 / 8, width: 0.25 },
    { x: 2 / 6, y: 5 / 8, width: 0.28 },
    { x: 5 / 6, y: 4 / 5, width: 0.22 },
  ],
  [
    { x: 1 / 10, y: 2 / 5, width: 0.23 },
    { x: 3 / 8, y: 1 / 8, width: 0.26 },
    { x: 6 / 8, y: 3 / 8, width: 0.24 },
    { x: 7 / 8, y: 3 / 4, width: 0.24 },
  ],
  [
    { x: 1 / 8, y: 3 / 4, width: 0.24 },
    { x: 3 / 8, y: 1 / 4, width: 0.27 },
    { x: 6 / 8, y: 1 / 8, width: 0.23 },
    { x: 7 / 8, y: 1 / 2, width: 0.25 },
  ],
]

export const VOLUME_STORAGE_KEY = 'mone-button-volume'

export const formatUploadDate = (uploadDate: string): string => {
  if (/^\d{8}$/.test(uploadDate)) {
    return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`
  }

  return uploadDate
}

export interface SameSerifLabel {
  date: string
  no?: number
}

const groupBy = <K, V>(items: V[], keyOf: (item: V) => K): Map<K, V[]> => {
  const groups = new Map<K, V[]>()
  items.forEach((item) => {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  })
  return groups
}

// serif が同じボタンを見分けるための配信日と、同じ日に同じ serif が複数あるときの通し番号を返す。
// 同じ日の配信の前後はデータから分からないため、番号は videoId → 開始秒の順（一覧の配信順と同じ）で振る。
export const buildSameSerifLabels = (clips: VoiceClip[]): Map<string, SameSerifLabel> => {
  const labels = new Map<string, SameSerifLabel>()

  groupBy(clips, (clip) => clip.serif).forEach((sameSerif) => {
    if (sameSerif.length < 2) {
      return
    }

    groupBy(sameSerif, (clip) => clip.videoFile.metadata.uploadDate).forEach((sameDay, uploadDate) => {
      const ordered = [...sameDay].sort(
        (a, b) => a.videoId.localeCompare(b.videoId, 'ja') || a.trimming.startTime - b.trimming.startTime,
      )
      ordered.forEach((clip, index) => {
        labels.set(clip.fileBaseName, {
          date: formatUploadDate(uploadDate),
          no: ordered.length > 1 ? index + 1 : undefined,
        })
      })
    })
  })

  return labels
}
