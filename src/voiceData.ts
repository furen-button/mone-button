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

export const voiceClips: VoiceClip[] = Object.entries(dataModules)
  .map(([path, data]) => {
    const filename = path.split('/').pop()
    if (!filename) {
      return null
    }

    const fileBaseName = filename.replace(/\.json$/i, '')
    return {
      ...data,
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
