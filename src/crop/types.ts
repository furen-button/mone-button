import type { CameraAspect, CameraFrame } from '../../scripts/create-video/camera.js'

export type { CameraAspect, CameraFrame }

export type Ease = NonNullable<CameraFrame['ease']>

export type SourceProbe = { width: number; height: number; fps: number; duration: number }

export type ClipSource = { source: string; size: number; probe: SourceProbe | null }

// GET /__cv/crop/clip/<base> の clip。照合できたクリップと、サーバ上の元動画。
export type ClipMatch = {
  base: string
  videoId: string
  serif: string
  camera: Partial<Record<CameraAspect, CameraFrame[]>>
  sources: ClipSource[]
}

export type UploadResult = {
  source: string
  name: string
  size: number
  probe: SourceProbe
  clip: ClipMatch | null
}

export type Scaler = 'anime4k' | 'lanczos'

export type CropRequest = {
  source: string
  keyframes: CameraFrame[]
  aspect: CameraAspect
  size: string
  scaler: Scaler
}

export type CropStillMeta = {
  rect: { x: number; y: number; w: number; h: number }
  backend: 'libplacebo' | 'sendcmd'
  enhance: boolean
  ms: number
  cached: boolean
}

export type Tracks = Record<CameraAspect, CameraFrame[]>

export const ASPECTS: CameraAspect[] = ['9:16', '16:9', '1:1']

// crop.js の EXPORT_SIZES と揃える。サーバ側でも allowlist で検査する。
export const EXPORT_SIZES: Record<CameraAspect, string[]> = {
  '9:16': ['1080x1920', '720x1280'],
  '16:9': ['1920x1080', '1280x720'],
  '1:1': ['1080x1080'],
}

export const EASE_LABELS: Record<Ease, string> = {
  smooth: '滑らか',
  linear: '一定速度',
  cut: 'カット',
}
